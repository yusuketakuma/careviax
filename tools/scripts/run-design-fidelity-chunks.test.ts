import { describe, expect, it } from 'vitest';
import { DESIGN_SCREENS } from '../tests/helpers/design-screen-map';
import { buildChunkDefinitions } from './run-design-fidelity-chunks';

describe('run-design-fidelity-chunks', () => {
  it('derives capture chunks from the design screen map', () => {
    const chunks = buildChunkDefinitions(DESIGN_SCREENS);
    const byName = new Map(chunks.map((chunk) => [chunk.name, chunk.screenIds]));

    expect(byName.get('new')).toEqual(
      DESIGN_SCREENS.filter((screen) => screen.screenId.startsWith('new_')).map(
        (screen) => screen.screenId,
      ),
    );
    expect(byName.get('p1')).toEqual(
      DESIGN_SCREENS.filter((screen) => screen.screenId.startsWith('p1_')).map(
        (screen) => screen.screenId,
      ),
    );

    const p0Chunked = [
      ...(byName.get('p0-a') ?? []),
      ...(byName.get('p0-b') ?? []),
      ...(byName.get('p0-c') ?? []),
    ];
    expect(p0Chunked).toEqual(
      DESIGN_SCREENS.filter((screen) => screen.screenId.startsWith('p0_')).map(
        (screen) => screen.screenId,
      ),
    );
  });

  it('keeps the smoke chunk focused on the recently fixed loading-risk screens', () => {
    const smoke = buildChunkDefinitions(DESIGN_SCREENS).find((chunk) => chunk.name === 'smoke');

    expect(smoke?.screenIds).toEqual([
      'p0_08_card_detail_workspace',
      'p0_47_print_preview',
      'p0_48_mobile_evidence_capture',
    ]);
  });
});
