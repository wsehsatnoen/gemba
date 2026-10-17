/**
 * The pace that equals the facility median, drawn as the dashed reference line.
 *
 * From the contract (`PacePct` in api/openapi.yaml): pace is the facility median
 * duration ÷ the partner's median duration × 100, so 100 is the facility median
 * and higher is faster. This is a fixed point of that definition, not a threshold;
 * the backend decides the FASTER / SIMILAR / SLOWER bands.
 */
export const FACILITY_PACE_PCT = 100;
