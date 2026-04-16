import {
    error,
    generateIncidentId,
    insertEvent,
    json,
    listIncidents,
    nowIso,
    parseJson
} from "../_lib.js";

export async function onRequestGet(context) {
    const incidents = await listIncidents(context.env);
    return json({ incidents });
}

export async function onRequestPost(context) {
    const body = await parseJson(context.request);
    if (!body) return error("Invalid JSON body.");

    const requiredFields = [
        "operator",
        "supplier",
        "batchNumber",
        "partNumber",
        "quantity",
        "buyer",
        "errorType"
    ];

    for (const field of requiredFields) {
        if (!body[field] && body[field] !== 0) {
            return error(`Missing field: ${field}`);
        }
    }

    const quantity = Number(body.quantity);
    if (!Number.isInteger(quantity) || quantity <= 0) {
        return error("Quantity must be a positive integer.");
    }

    const id = generateIncidentId();
    const createdAt = nowIso();
    const comment = typeof body.comment === "string" ? body.comment.trim() : "";

    await context.env.DB.prepare(
        `INSERT INTO incidents (
            id, batch_number, part_number, quantity, operator, supplier, buyer, error_type,
            comment, status, created_at, resolved_at, deleted_at, deleted_reason, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Open', ?, NULL, NULL, '', ?)`
    ).bind(
        id,
        body.batchNumber.trim(),
        body.partNumber.trim(),
        quantity,
        body.operator.trim(),
        body.supplier.trim(),
        body.buyer.trim(),
        body.errorType.trim(),
        comment,
        createdAt,
        createdAt
    ).run();

    await insertEvent(context.env, id, "created", {
        batchNumber: body.batchNumber.trim(),
        partNumber: body.partNumber.trim(),
        quantity,
        operator: body.operator.trim(),
        supplier: body.supplier.trim(),
        buyer: body.buyer.trim(),
        errorType: body.errorType.trim()
    });

    return json({ ok: true, id }, { status: 201 });
}
