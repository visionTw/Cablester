# Terrain brush and compositional stamps

The Level Editor terrain mode is an authoring accelerator over the existing level/world contracts. It does not introduce a TileMap, TerrainSet, grid-owned save format, or a second runtime source of truth.

## Tools

- **Continuous platform** samples a pointer stroke at a deterministic cadence and expands it into existing `platform` objects.
- **Slope** creates one existing `slope` object from the stroke start to its end.
- **Erase terrain** removes only `platform` and `slope` objects touched by the brush. Spawn, goal, checkpoints, hazards, and other gameplay objects are protected.
- **20 px snapping** is optional authoring assistance. With snapping disabled, integer free-position coordinates remain canonical.

One stroke creates one undo step. Pointer event frequency does not change the sampled result for the same geometric path.

## Compositional stamps

Stamps are macros, not persistent prefab instances. Placement immediately expands into editable canonical primitives:

- `ascending-steps`: four platform objects.
- `hazard-corridor`: two platforms and one hazard.
- `root-arch-island`: one platform, one checkpoint, and one bounded, non-repeating midground scene layer.

After placement, every object and scene layer can be selected, moved, resized, restyled, or deleted independently. Scene stamps deliberately use a small number of `repeatX: false` layers so they do not multiply the draw-layer budget.

## Canonical Chunk workflow

1. Open World Studio and select a Region/Chunk/Object within the target Chunk.
2. Choose **在关卡工坊编辑 Chunk**.
3. Edit with terrain tools, stamps, object tools, assets, support settings, or scene layers.
4. Choose **应用到当前 Chunk**.
5. Back in World Studio, run validation and save the canonical world explicitly.

The bridge uses the frozen `chunkToLevelDocument` and `applyLevelDocumentToChunk` adapters. Existing stable IDs, transforms, links, tags, and allowed extensions survive round-trip editing. Newly painted terrain receives stable IDs through the existing level-object allocator. Applying from the workshop only updates the in-memory World Studio draft; it never writes the repository by itself.

Formal content remains available only when World Studio is running against an explicitly configured private formal-world repository. Public builds contain only public world packages.

## Verification contract

- `test/terrain-authoring.test.js` covers deterministic stroke sampling, optional snapping, protected erasing, stamp expansion, stable IDs, and canonical adapter round trips.
- `npm test` covers the complete Web and world contracts.
- `npm run check` and `npm run build` enforce the public-repository boundary and production bundle.
- Godot verification consumes the resulting canonical world through the approved isolated runner; the Web editor never launches Godot against a source checkout.
