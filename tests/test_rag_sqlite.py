import io
from pathlib import Path
import sqlite3
from tempfile import TemporaryDirectory
import unittest

from aidream.knowledge import SQLiteKnowledgeIndex
from aidream.rag.sqlite_inspector import (
    SQLiteInspectorError,
    SQLiteSecurityError,
    compute_file_sha256,
    generate_schema_card,
    inspect_sqlite_database,
    is_sqlite_file,
    safe_sqlite_query,
)
from aidream.rag.source_store import SQLiteSourceStore, SourceStoreError


def create_sample_database(db_path: Path):
    conn = sqlite3.connect(db_path)
    conn.executescript("""
        CREATE TABLE customers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT NOT NULL,
            password_hash TEXT NOT NULL,
            status TEXT DEFAULT 'active'
        );

        CREATE TABLE orders (
            order_id TEXT PRIMARY KEY,
            customer_id INTEGER NOT NULL,
            amount REAL NOT NULL,
            notes TEXT,
            FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
        );

        CREATE VIEW customer_order_summary AS
            SELECT c.name, COUNT(o.order_id) as total_orders, COALESCE(SUM(o.amount), 0) as total_spent
            FROM customers c
            LEFT JOIN orders o ON c.id = o.customer_id
            GROUP BY c.id;

        INSERT INTO customers (name, email, password_hash, status) VALUES
            ('Alice Smith', 'alice@example.com', 'secret_hash_1', 'active'),
            ('Bob Jones', 'bob@example.com', 'secret_hash_2', 'active'),
            ('Charlie Brown', 'charlie@example.com', 'secret_hash_3', 'pending');

        INSERT INTO orders (order_id, customer_id, amount, notes) VALUES
            ('ORD-101', 1, 49.99, 'Delivered to front porch'),
            ('ORD-102', 1, 120.50, 'Gift wrap requested'),
            ('ORD-103', 2, 15.00, 'Urgent delivery');
    """)
    conn.commit()
    conn.close()


class TestSQLiteInspector(unittest.TestCase):
    def setUp(self):
        self.temp_dir = TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "test.sqlite"
        create_sample_database(self.db_path)

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_is_sqlite_file(self):
        self.assertTrue(is_sqlite_file(self.db_path))
        not_sqlite = Path(self.temp_dir.name) / "text.txt"
        not_sqlite.write_text("Hello world")
        self.assertFalse(is_sqlite_file(not_sqlite))
        self.assertTrue(is_sqlite_file(b"SQLite format 3\x00extra data"))
        self.assertFalse(is_sqlite_file(b"PK\x03\x04zipfile"))

    def test_compute_file_sha256(self):
        digest = compute_file_sha256(self.db_path)
        self.assertEqual(len(digest), 64)
        self.assertTrue(all(c in "0123456789abcdef" for c in digest))

    def test_inspect_sqlite_database(self):
        profile = inspect_sqlite_database(self.db_path)
        self.assertEqual(profile.file_name, "test.sqlite")
        self.assertGreater(profile.file_size_bytes, 0)
        self.assertEqual(len(profile.tables), 2)
        self.assertEqual(len(profile.views), 1)

        table_names = {t.name for t in profile.tables}
        self.assertEqual(table_names, {"customers", "orders"})

        # Inspect customers table
        customers = next(t for t in profile.tables if t.name == "customers")
        self.assertEqual(customers.primary_keys, ["id"])
        self.assertEqual(customers.row_count, 3)
        self.assertTrue(customers.row_count_exact)

        col_names = {c.name: c for c in customers.columns}
        self.assertIn("name", col_names)
        self.assertEqual(col_names["name"].data_type, "TEXT")
        self.assertFalse(col_names["name"].nullable)
        self.assertIn("Alice Smith", col_names["name"].samples)

        # Sensitive column must NOT have samples extracted
        self.assertIn("password_hash", col_names)
        self.assertEqual(col_names["password_hash"].samples, [])

        # Inspect orders table foreign keys
        orders = next(t for t in profile.tables if t.name == "orders")
        self.assertEqual(orders.row_count, 3)
        self.assertEqual(len(orders.foreign_keys), 1)
        fk = orders.foreign_keys[0]
        self.assertEqual(fk.from_column, "customer_id")
        self.assertEqual(fk.target_table, "customers")
        self.assertEqual(fk.target_column, "id")

        # Inspect views
        summary_view = profile.views[0]
        self.assertEqual(summary_view.name, "customer_order_summary")
        self.assertTrue(summary_view.is_view)

    def test_generate_schema_card(self):
        profile = inspect_sqlite_database(self.db_path)
        card = generate_schema_card(profile)
        self.assertIn("# Database Schema: test.sqlite", card)
        self.assertIn("### Table `customers` (3 rows)", card)
        self.assertIn("### Table `orders` (3 rows)", card)
        self.assertIn("### View `customer_order_summary`", card)
        self.assertIn("`customer_id` -> `customers(id)`", card)
        self.assertIn('"Alice Smith"', card)

    def test_safe_sqlite_query_success(self):
        res = safe_sqlite_query(self.db_path, "SELECT name, email FROM customers ORDER BY id LIMIT 2")
        self.assertEqual(res["columns"], ["name", "email"])
        self.assertEqual(len(res["rows"]), 2)
        self.assertEqual(res["rows"][0], ["Alice Smith", "alice@example.com"])
        self.assertEqual(res["row_count"], 2)
        self.assertFalse(res["truncated"])

        # Test aggregate functions
        agg = safe_sqlite_query(self.db_path, "SELECT count(*), round(avg(amount), 2) FROM orders")
        self.assertEqual(agg["rows"][0][0], 3)
        self.assertAlmostEqual(agg["rows"][0][1], 61.83)

    def test_safe_sqlite_query_security_blocks(self):
        # Deny writes / mutations
        with self.assertRaises(SQLiteSecurityError):
            safe_sqlite_query(self.db_path, "INSERT INTO customers (name, email) VALUES ('Hacker', 'h@h.com')")

        with self.assertRaises(SQLiteSecurityError):
            safe_sqlite_query(self.db_path, "DROP TABLE orders")

        with self.assertRaises(SQLiteSecurityError):
            safe_sqlite_query(self.db_path, "DELETE FROM customers")

        # Deny multi-statement injection
        with self.assertRaises(SQLiteSecurityError):
            safe_sqlite_query(self.db_path, "SELECT 1; DROP TABLE customers")

        # Deny ATTACH
        with self.assertRaises(SQLiteSecurityError):
            safe_sqlite_query(self.db_path, "ATTACH DATABASE ':memory:' AS test2")


class TestSQLiteSourceStore(unittest.TestCase):
    def setUp(self):
        self.temp_dir = TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "original.sqlite"
        create_sample_database(self.db_path)
        self.knowledge_db = Path(self.temp_dir.name) / "knowledge.sqlite3"
        self.knowledge = SQLiteKnowledgeIndex(self.knowledge_db)
        self.store = SQLiteSourceStore(Path(self.temp_dir.name) / "storage", knowledge_index=self.knowledge)

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_save_and_list_sources(self):
        meta = self.store.save_sqlite_source("my_store.db", self.db_path)
        self.assertIn("source_id", meta)
        self.assertEqual(meta["file_name"], "my_store.db")
        self.assertIsNotNone(meta["knowledge_doc_id"])

        sources = self.store.list_sources()
        self.assertEqual(len(sources), 1)
        self.assertEqual(sources[0]["source_id"], meta["source_id"])

        # Knowledge index should have the registered schema card
        docs = self.knowledge.list_documents()
        self.assertEqual(docs["count"], 1)
        self.assertEqual(docs["documents"][0]["name"], "my_store_schema.md")

        # Query source via store
        query_res = self.store.query_source(meta["source_id"], "SELECT count(*) FROM customers")
        self.assertEqual(query_res["rows"][0][0], 3)

        # Delete source
        deleted = self.store.delete_source(meta["source_id"])
        self.assertTrue(deleted)
        self.assertEqual(len(self.store.list_sources()), 0)
        # Knowledge document should be cleaned up
        self.assertEqual(self.knowledge.list_documents()["count"], 0)


if __name__ == "__main__":
    unittest.main()
