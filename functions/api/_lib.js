const REFERENCE_CATEGORIES = {
    operators: "operator",
    suppliers: "supplier",
    buyers: "buyer",
    errorTypes: "errorType"
};

const EXTENDED_SCHEMA_STATEMENTS = [
    `CREATE TABLE IF NOT EXISTS incident_details (
        incident_id TEXT PRIMARY KEY,
        reference_notes TEXT NOT NULL DEFAULT '',
        error_types_json TEXT NOT NULL DEFAULT '[]',
        attachments_json TEXT NOT NULL DEFAULT '[]',
        recipients_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (incident_id) REFERENCES incidents(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS email_recipients (
        id TEXT PRIMARY KEY,
        first_name TEXT NOT NULL DEFAULT '',
        last_name TEXT NOT NULL DEFAULT '',
        email TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`
];

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

function parseStoredJson(value, fallback) {
    if (typeof value !== "string" || !value.trim()) return fallback;
    try {
        return JSON.parse(value);
    } catch {
        return fallback;
    }
}

function normalizeRecipient(recipient) {
    if (!recipient || typeof recipient !== "object") return null;
    const email = typeof recipient.email === "string" ? recipient.email.trim() : "";
    if (!email) return null;

    return {
        id: typeof recipient.id === "string" && recipient.id.trim()
            ? recipient.id.trim()
            : crypto.randomUUID(),
        firstName: typeof recipient.firstName === "string" ? recipient.firstName.trim() : "",
        lastName: typeof recipient.lastName === "string" ? recipient.lastName.trim() : "",
        email
    };
}

function normalizeAttachment(attachment) {
    if (!attachment || typeof attachment !== "object") return null;
    const dataUrl = typeof attachment.dataUrl === "string" ? attachment.dataUrl : "";
    if (!dataUrl.startsWith("data:")) return null;

    return {
        id: typeof attachment.id === "string" && attachment.id.trim()
            ? attachment.id.trim()
            : crypto.randomUUID(),
        name: typeof attachment.name === "string" && attachment.name.trim()
            ? attachment.name.trim()
            : "attachment",
        type: typeof attachment.type === "string" && attachment.type.trim()
            ? attachment.type.trim()
            : "application/octet-stream",
        size: Number.isFinite(Number(attachment.size)) ? Number(attachment.size) : 0,
        dataUrl
    };
}

async function ensureExtendedSchema(env) {
    for (const statement of EXTENDED_SCHEMA_STATEMENTS) {
        await env.DB.prepare(statement).run();
    }
}

function mapIncidentRow(row) {
    const parsedErrorTypes = parseStoredJson(row.error_types_json, null);
    const errorTypesSelected = Array.isArray(parsedErrorTypes)
        ? parsedErrorTypes
        : (row.error_type
            ? String(row.error_type).split(" | ").map((value) => value.trim()).filter(Boolean)
            : []);

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
        referenceNotes: row.reference_notes || "",
        errorTypesSelected,
        attachments: parseStoredJson(row.attachments_json, []).map(normalizeAttachment).filter(Boolean),
        recipients: parseStoredJson(row.recipients_json, []).map(normalizeRecipient).filter(Boolean),
        status: row.status,
        createdAt: row.created_at,
        resolvedAt: row.resolved_at,
        deletedAt: row.deleted_at,
        deletedReason: row.deleted_reason || ""
    };
}

async function listIncidents(env) {
    await ensureExtendedSchema(env);
    const result = await env.DB.prepare(
        `SELECT incidents.*,
                COALESCE(incident_details.reference_notes, '') AS reference_notes,
                COALESCE(incident_details.error_types_json, '[]') AS error_types_json,
                COALESCE(incident_details.attachments_json, '[]') AS attachments_json,
                COALESCE(incident_details.recipients_json, '[]') AS recipients_json
         FROM incidents
         LEFT JOIN incident_details ON incident_details.incident_id = incidents.id
         ORDER BY datetime(incidents.created_at) DESC`
    ).all();
    return (result.results || []).map(mapIncidentRow);
}

async function listReferences(env) {
    await ensureExtendedSchema(env);
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

    const recipientRows = await env.DB.prepare(
        `SELECT id, first_name, last_name, email
         FROM email_recipients
         ORDER BY lower(last_name), lower(first_name), lower(email)`
    ).all();

    references.recipients = (recipientRows.results || []).map((row) => ({
        id: row.id,
        firstName: row.first_name || "",
        lastName: row.last_name || "",
        email: row.email
    }));

    return references;
}

async function getSettings(env) {
    await ensureExtendedSchema(env);
    const rows = await env.DB.prepare(
        `SELECT key, value
         FROM app_settings`
    ).all();

    const settings = {
        emailIntro: ""
    };

    for (const row of rows.results || []) {
        if (row.key === "emailIntro") settings.emailIntro = row.value || "";
    }

    return settings;
}

async function insertEvent(env, incidentId, eventType, payload = {}) {
    await env.DB.prepare(
        `INSERT INTO incident_events (incident_id, event_type, payload_json, created_at)
         VALUES (?, ?, ?, ?)`
    ).bind(incidentId, eventType, JSON.stringify(payload), nowIso()).run();
}

async function findIncident(env, incidentId) {
    await ensureExtendedSchema(env);
    const row = await env.DB.prepare(
        `SELECT incidents.*,
                COALESCE(incident_details.reference_notes, '') AS reference_notes,
                COALESCE(incident_details.error_types_json, '[]') AS error_types_json,
                COALESCE(incident_details.attachments_json, '[]') AS attachments_json,
                COALESCE(incident_details.recipients_json, '[]') AS recipients_json
         FROM incidents
         LEFT JOIN incident_details ON incident_details.incident_id = incidents.id
         WHERE incidents.id = ?`
    ).bind(incidentId).first();
    return row ? mapIncidentRow(row) : null;
}

export {
    REFERENCE_CATEGORIES,
    error,
    ensureExtendedSchema,
    findIncident,
    generateIncidentId,
    getSettings,
    insertEvent,
    json,
    listIncidents,
    listReferences,
    normalizeAttachment,
    normalizeRecipient,
    nowIso,
    parseJson
};
