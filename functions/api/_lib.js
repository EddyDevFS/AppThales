const REFERENCE_CATEGORIES = {
    operators: "operator",
    suppliers: "supplier",
    buyers: "buyer",
    errorTypes: "errorType"
};

function json(data, init = {}) {
    const headers = new Headers(init.headers || {});
    headers.set("content-type", "application/json; charset=UTF-8");
    return new Response(JSON.stringify(data), { ...init, headers });
}

function error(message, status = 400) {
    return json({ error: message }, { status });
}

async function parseJson(request) {
    try {
        return await request.json();
    } catch {
        return null;
    }
}

function nowIso() {
    return new Date().toISOString();
}

function generateIncidentId() {
    const stamp = Date.now().toString().slice(-6);
    const random = crypto.getRandomValues(new Uint32Array(1))[0].toString().slice(-3);
    return `INC-${stamp}-${random.padStart(3, "0")}`;
}

function mapIncidentRow(row) {
    return {
        id: row.id,
        batchNumber: row.batch_number,
        partNumber: row.part_number,
        quantity: row.quantity,
        operator: row.operator,
        supplier: row.supplier,
        buyer: row.buyer,
        errorType: row.error_type,
        comment: row.comment || "",
        status: row.status,
        createdAt: row.created_at,
        resolvedAt: row.resolved_at,
        deletedAt: row.deleted_at,
        deletedReason: row.deleted_reason || ""
    };
}

async function listIncidents(env) {
    const result = await env.DB.prepare(
        `SELECT id, batch_number, part_number, quantity, operator, supplier, buyer, error_type,
                comment, status, created_at, resolved_at, deleted_at, deleted_reason
         FROM incidents
         ORDER BY datetime(created_at) DESC`
    ).all();
    return (result.results || []).map(mapIncidentRow);
}

async function listReferences(env) {
    const result = await env.DB.prepare(
        `SELECT category, value
         FROM reference_items
         ORDER BY category, value`
    ).all();

    const references = {
        operators: [],
        suppliers: [],
        buyers: [],
        errorTypes: []
    };

    for (const row of result.results || []) {
        const key = Object.keys(REFERENCE_CATEGORIES).find(
            (candidate) => REFERENCE_CATEGORIES[candidate] === row.category
        );
        if (key) references[key].push(row.value);
    }

    return references;
}

async function insertEvent(env, incidentId, eventType, payload = {}) {
    await env.DB.prepare(
        `INSERT INTO incident_events (incident_id, event_type, payload_json, created_at)
         VALUES (?, ?, ?, ?)`
    ).bind(incidentId, eventType, JSON.stringify(payload), nowIso()).run();
}

async function findIncident(env, incidentId) {
    const row = await env.DB.prepare(
        `SELECT id, batch_number, part_number, quantity, operator, supplier, buyer, error_type,
                comment, status, created_at, resolved_at, deleted_at, deleted_reason
         FROM incidents
         WHERE id = ?`
    ).bind(incidentId).first();
    return row ? mapIncidentRow(row) : null;
}

export {
    REFERENCE_CATEGORIES,
    error,
    findIncident,
    generateIncidentId,
    insertEvent,
    json,
    listIncidents,
    listReferences,
    nowIso,
    parseJson
};
