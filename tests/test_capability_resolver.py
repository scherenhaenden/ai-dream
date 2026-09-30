import unittest
from itertools import permutations

from aidream.capabilities import ArtifactKind, ArtifactType, ResolutionRequest, RouteCandidate, resolve_route


def route(route_id, model_id, *, verified=False, loaded=False, memory=100, available=1000,
          dependencies=True, features=(), profile=None, evidence_status=None, priority=0):
    return RouteCandidate(
        id=route_id, capability_id="text.chat", model_id=model_id, runtime_id="runtime.test",
        inputs=(ArtifactType(ArtifactKind.TEXT),), outputs=(ArtifactType(ArtifactKind.TEXT),),
        profile_id=profile,
        priority=priority,
        features=frozenset(features), evidence_status=evidence_status or ("verified" if verified else "unknown"),
        loaded=loaded, required_memory_bytes=memory, available_memory_bytes=available,
        dependencies_available=dependencies,
    )


class CapabilityResolverTests(unittest.TestCase):
    def test_selection_is_stable_and_prefers_verified_before_loaded(self):
        request = ResolutionRequest("text.chat", ArtifactType(ArtifactKind.TEXT))
        candidates = [route("z", "loaded", loaded=True), route("a", "verified", verified=True)]
        first = resolve_route(request, candidates)
        second = resolve_route(request, reversed(candidates))
        self.assertEqual(first.selected.model_id, "verified")
        self.assertEqual(first.to_dict(), second.to_dict())
        self.assertEqual(first.alternatives[0].model_id, "loaded")
        reasons = {item["route_id"]: item for item in first.why}
        self.assertTrue(reasons["a"]["selection_factors"]["verified_preference_met"])
        self.assertFalse(reasons["z"]["selection_factors"]["verified_preference_met"])

    def test_semantic_profile_preference_and_disabled_verification_preference(self):
        request = ResolutionRequest("text.chat", ArtifactType(ArtifactKind.TEXT),
                                    preferred_model_id="preferred-model", preferred_profile_id="quality",
                                    prefer_verified=False, prefer_loaded=False)
        candidates = [route("other-profile", "preferred-model", profile="fast"),
                      route("preferred-profile", "preferred-model", profile="quality"),
                      route("verified-model", "verified-model", verified=True, profile="quality")]
        result = resolve_route(request, candidates)
        self.assertEqual(result.selected.id, "preferred-profile")
        self.assertEqual(result.to_dict()["route"]["profile_id"], "quality")
        self.assertEqual(result.to_dict()["alternatives"][0]["profile_id"], "fast")
        why = {item["route_id"]: item for item in result.why}
        self.assertTrue(why["preferred-profile"]["selection_factors"]["profile_preference"]["matched"])
        self.assertFalse(why["preferred-profile"]["selection_factors"]["verified_preference_met"])
        self.assertEqual(why["preferred-profile"]["selection_factors"]["profile_preference"]["candidate"], "quality")

        verified_preferred = resolve_route(ResolutionRequest(
            "text.chat", ArtifactType(ArtifactKind.TEXT), preferred_model_id="preferred-model"), candidates)
        self.assertEqual(verified_preferred.selected.id, "verified-model",
                         "verified evidence ranks ahead of semantic model preference by contract")

    def test_manual_pin_is_hard_constraint_and_does_not_substitute(self):
        request = ResolutionRequest("text.chat", ArtifactType(ArtifactKind.TEXT), mode="manual", pinned_model_id="missing")
        result = resolve_route(request, [route("a", "present")])
        self.assertIsNone(result.selected)
        self.assertIn("not_pinned_model", result.why[0]["reasons"])

    def test_pinned_profile_is_a_hard_constraint(self):
        request = ResolutionRequest("text.chat", ArtifactType(ArtifactKind.TEXT), mode="manual",
                                    pinned_model_id="model", pinned_profile_id="quality")
        result = resolve_route(request, [route("fast", "model", profile="fast")])
        self.assertIsNone(result.selected)
        self.assertIn("not_pinned_profile", result.why[0]["reasons"])
        result = resolve_route(request, [route("fast", "model", profile="fast"),
                                         route("quality", "model", profile="quality")])
        self.assertEqual(result.selected.id, "quality")

    def test_hard_filters_explain_rejections(self):
        request = ResolutionRequest("text.chat", ArtifactType(ArtifactKind.TEXT), required_features=frozenset({"tools"}))
        candidates = [route("a", "low-memory", memory=1000, available=100),
                      route("b", "no-deps", dependencies=False), route("c", "no-feature")]
        result = resolve_route(request, candidates)
        self.assertIsNone(result.selected)
        reasons = {entry["route_id"]: entry["reasons"] for entry in result.why}
        self.assertIn("insufficient_resources", reasons["a"])
        self.assertIn("missing_dependencies", reasons["b"])
        self.assertIn("missing_features:tools", reasons["c"])

    def test_failed_evidence_is_a_hard_rejection(self):
        result = resolve_route(ResolutionRequest("text.chat", ArtifactType(ArtifactKind.TEXT)), [
            route("failed", "model", evidence_status="failed"),
        ])
        self.assertIsNone(result.selected)
        self.assertIn("capability_evidence_failed", result.why[0]["reasons"])

    def test_headroom_is_applied_to_memory_estimate(self):
        request = ResolutionRequest("text.chat", ArtifactType(ArtifactKind.TEXT), resource_headroom_percent=10)
        result = resolve_route(request, [route("a", "m", memory=100, available=109)])
        self.assertIsNone(result.selected)
        self.assertIn("insufficient_resources", result.why[0]["reasons"])

    def test_headroom_rounds_up_at_fractional_byte_boundary(self):
        request = ResolutionRequest("text.chat", ArtifactType(ArtifactKind.TEXT), resource_headroom_percent=10)
        result = resolve_route(request, [route("a", "m", memory=101, available=111)])
        self.assertIsNone(result.selected)
        self.assertIn("insufficient_resources", result.why[0]["reasons"])

    def test_unknown_resource_estimate_policy_is_explicit_and_explained(self):
        candidate = route("unknown-memory", "model", memory=None, available=1000)
        allowed = resolve_route(ResolutionRequest(
            "text.chat", ArtifactType(ArtifactKind.TEXT), unknown_resource_policy="allow"), [candidate])
        self.assertEqual(allowed.selected, candidate)
        explanation = allowed.why[0]["selection_factors"]["resource_estimate"]
        self.assertEqual(explanation, {"required_bytes": None, "available_bytes": 1000, "unknown_policy": "allow"})

        rejected = resolve_route(ResolutionRequest(
            "text.chat", ArtifactType(ArtifactKind.TEXT), unknown_resource_policy="reject"), [candidate])
        self.assertIsNone(rejected.selected)
        self.assertIn("resource_estimate_unknown", rejected.why[0]["reasons"])
        with self.assertRaisesRegex(ValueError, "unknown_resource_policy"):
            ResolutionRequest("text.chat", ArtifactType(ArtifactKind.TEXT), unknown_resource_policy="guess")
        with self.assertRaisesRegex(ValueError, "unknown_resource_policy"):
            ResolutionRequest("text.chat", ArtifactType(ArtifactKind.TEXT), unknown_resource_policy=[])

    def test_selection_and_explanations_are_stable_for_every_candidate_order(self):
        request = ResolutionRequest("text.chat", ArtifactType(ArtifactKind.TEXT),
                                    preferred_model_id="model-c")
        candidates = (
            route("a", "model-a", priority=3),
            route("b", "model-b", verified=True, loaded=True),
            route("c", "model-c", priority=9),
            route("d", "model-d", memory=2000),
        )
        expected = resolve_route(request, candidates).to_dict()
        for order in permutations(candidates):
            self.assertEqual(resolve_route(request, order).to_dict(), expected)

    def test_route_ids_must_be_unique_for_unambiguous_selection_explanations(self):
        with self.assertRaisesRegex(ValueError, "route IDs must be unique"):
            resolve_route(ResolutionRequest("text.chat", ArtifactType(ArtifactKind.TEXT)), [
                route("duplicate", "one"), route("duplicate", "two"),
            ])

    def test_manual_requires_a_pin(self):
        with self.assertRaises(ValueError):
            ResolutionRequest("text.chat", ArtifactType(ArtifactKind.TEXT), mode="manual")


if __name__ == "__main__":
    unittest.main()
