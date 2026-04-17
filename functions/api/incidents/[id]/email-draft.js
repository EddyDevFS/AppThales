import { ensureExtendedSchema, error, findIncident, getSettings, json } from "../../_lib.js";

function buildEmailSubject(incident) {
    return `[THALES] ${incident.errorType} | Batch ${incident.batchNumber} | Part ${incident.partNumber}`;
}

function buildEmailBody(incident, emailIntro) {
    const recipientLabel = incident.recipients.length
        ? incident.recipients
            .map((recipient) => {
                const fullName = `${recipient.firstName || ""} ${recipient.lastName || ""}`.trim();
                return fullName ? `${fullName} <${recipient.email}>` : recipient.email;
            })
            .join(", ")
        : "None.";
    const reasons = incident.errorTypesSelected?.length
        ? incident.errorTypesSelected.join(", ")
        : (incident.errorType || "None.");

    const lines = [
        "Hello,",
        ""
    ];

    if (emailIntro) lines.push(emailIntro, "");

    lines.push("");
    lines.push("Incident summary");
    lines.push("----------------");
    lines.push(`Incident ID        : ${incident.id}`);
    lines.push(`Supplier           : ${incident.supplier}`);
    lines.push(`Buyer              : ${incident.buyer}`);
    lines.push(`Operator           : ${incident.operator}`);
    lines.push(`Recipients         : ${recipientLabel}`);
    lines.push(`Batch              : ${incident.batchNumber}`);
    lines.push(`Part number        : ${incident.partNumber}`);
    lines.push(`Quantity affected  : ${incident.quantity}`);
    lines.push(`Rejection reasons  : ${reasons}`);
    lines.push("");
    lines.push("Comments");
    lines.push("--------");
    lines.push(incident.comment || "None.");
    lines.push("");
    lines.push("Reference / Evidence");
    lines.push("--------------------");
    lines.push(incident.referenceNotes || "None.");

    return lines.join("\r\n");
}

function buildMailtoUrl(to, subject, body) {
    const encodedTo = to.map((value) => encodeURIComponent(value)).join(",");
    return `mailto:${encodedTo}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export async function onRequestGet(context) {
    await ensureExtendedSchema(context.env);
    const incidentId = context.params.id;
    const incident = await findIncident(context.env, incidentId);
    if (!incident) return error("Incident not found.", 404);
    if (!incident.recipients.length) return error("No recipient selected for this incident.");

    const settings = await getSettings(context.env);
    const subject = buildEmailSubject(incident);
    const body = buildEmailBody(incident, settings.emailIntro || "");
    const to = incident.recipients.map((recipient) => recipient.email);
    return json({
        ok: true,
        to,
        subject,
        body,
        mailtoUrl: buildMailtoUrl(to, subject, body),
        warning: incident.attachments.length
            ? "Web email drafts cannot attach incident files automatically. Add attachments manually in your mail client."
            : ""
    });
}
