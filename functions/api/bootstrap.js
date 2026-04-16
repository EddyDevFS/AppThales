import { json, listIncidents, listReferences } from "./_lib.js";

export async function onRequestGet(context) {
    const [references, incidents] = await Promise.all([
        listReferences(context.env),
        listIncidents(context.env)
    ]);

    return json({ references, incidents });
}
