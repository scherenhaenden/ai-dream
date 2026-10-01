"""Deterministic, fault-tolerant registry for declarative skill manifests."""
from __future__ import annotations

from collections.abc import Iterable, Mapping
from copy import deepcopy
from dataclasses import dataclass
from typing import Any

from .contracts import SkillContractError, validate_skill_manifest


@dataclass(frozen=True)
class InvalidSkill:
    source: str
    error: str


class SkillRegistry:
    """Validated immutable snapshot; malformed installed skills are isolated."""

    __slots__ = ("_skills", "_invalid")

    def __init__(self, manifests: Iterable[Mapping[str, Any]] = ()) -> None:
        valid: dict[tuple[str, str], dict[str, Any]] = {}
        invalid: list[InvalidSkill] = []
        for index, raw in enumerate(manifests):
            source = f"skill[{index}]"
            if isinstance(raw, Mapping):
                candidate_id, candidate_version = raw.get("id"), raw.get("version")
                if isinstance(candidate_id, str):
                    source = candidate_id + (f"@{candidate_version}" if isinstance(candidate_version, str) else "")
            try:
                clean = validate_skill_manifest(deepcopy(raw))
                key = (clean["id"], clean["version"])
                if key in valid:
                    raise SkillContractError(f"duplicate skill version {key[0]}@{key[1]}")
                valid[key] = clean
            except (SkillContractError, TypeError, ValueError) as exc:
                invalid.append(InvalidSkill(source, str(exc)[:500]))
        self._skills = dict(sorted(valid.items()))
        self._invalid = tuple(invalid)

    def snapshot(self) -> tuple[dict[str, Any], ...]:
        return tuple(deepcopy(self._skills[key]) for key in sorted(self._skills))

    def invalid_skills(self) -> tuple[InvalidSkill, ...]:
        return self._invalid

    def get(self, skill_id: str, version: str | None = None) -> dict[str, Any] | None:
        if version is not None:
            value = self._skills.get((skill_id, version))
            return deepcopy(value) if value is not None else None
        versions = [key for key in self._skills if key[0] == skill_id]
        return deepcopy(self._skills[versions[-1]]) if versions else None
