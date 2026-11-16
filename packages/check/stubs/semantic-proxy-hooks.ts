// The LLM review (semantic) layer is paid. The free service never runs it, whatever the environment says.
export function checkSemanticStrictPrecheck(): null {
  return null;
}
export async function runSemanticPipelineAfterPolicyAllow(): Promise<null> {
  return null;
}

/** Marks this as the free service's stand-in (checked by the tests). */
export const __mastyfCheckStub = true;
