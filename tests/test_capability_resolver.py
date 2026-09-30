import unittest

from aidream.capabilities import ArtifactKind, ArtifactType, ResolutionRequest, RouteCandidate, resolve_route


def route(route_id, model_id, *, verified=False, loaded=False, memory=100, available=1000,
          dependencies=True, features=()):
    return RouteCandidate(
        id=route_id, capability_id="text.chat", model_id=model_id, runtime_id="runtime.test",
        inputs=(ArtifactType(ArtifactKind.TEXT),), outputs=(ArtifactType(ArtifactKind.TEXT),),
        features=frozenset(features), evidence_status="verified" if verified else "unknown",
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

    def test_manual_pin_is_hard_constraint_and_does_not_substitute(self):
        request = ResolutionRequest("text.chat", ArtifactType(ArtifactKind.TEXT), mode="manual", pinned_model_id="missing")
        result = resolve_route(request, [route("a", "present")])
        self.assertIsNone(result.selected)
        self.assertIn("not_pinned_model", result.why[0]["reasons"])

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

    def test_headroom_is_applied_to_memory_estimate(self):
        request = ResolutionRequest("text.chat", ArtifactType(ArtifactKind.TEXT), resource_headroom_percent=10)
        result = resolve_route(request, [route("a", "m", memory=100, available=109)])
        self.assertIsNone(result.selected)
        self.assertIn("insufficient_resources", result.why[0]["reasons"])

    def test_manual_requires_a_pin(self):
        with self.assertRaises(ValueError):
            ResolutionRequest("text.chat", ArtifactType(ArtifactKind.TEXT), mode="manual")


if __name__ == "__main__":
    unittest.main()
