import { exportGraphFeatures } from './graph-scorer.js';
async function tryGraphOnnxRuntime(features, modelPath) {
    if (process.env.MASTYF_AI_FLEET_GRAPH_ONNX === 'false')
        return null;
    try {
        const moduleName = 'onnxruntime-' + 'node';
        const ort = await Function('return import(arguments[0])')(moduleName);
        const session = await ort.InferenceSession.create(modelPath);
        const inputName = session.inputNames[0];
        if (!inputName)
            return null;
        const tensor = new ort.Tensor('float32', Float32Array.from(features), [1, features.length]);
        const out = await session.run({ [inputName]: tensor });
        const output = out[session.outputNames[0]];
        if (!output)
            return null;
        const data = output.data;
        const score = data.length ? Math.max(...data) : 0.5;
        return { score, backend: 'onnxruntime', modelVersion: modelPath };
    }
    catch {
        return null;
    }
}
/** Run ONNX graph classifier on fleet chain events (A1 deployment path). */
export async function scoreGraphEventsWithOnnx(events) {
    const modelPath = process.env.MASTYF_AI_FLEET_GRAPH_ONNX_MODEL?.trim();
    if (!modelPath || !events.length)
        return null;
    const matrix = exportGraphFeatures(events);
    const pooled = new Array(8).fill(0);
    for (const row of matrix) {
        for (let i = 0; i < Math.min(8, row.length); i++)
            pooled[i] += row[i];
    }
    for (let i = 0; i < pooled.length; i++)
        pooled[i] /= matrix.length;
    return tryGraphOnnxRuntime(pooled, modelPath);
}
//# sourceMappingURL=graph-onnx-inference.js.map