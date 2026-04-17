(function(){
        "use strict";
        // ----- REFERENCE DATA (persisted via Electron locally or via Cloudflare on web) -----
        let operators = ["Maria Lopez", "James Carter", "Linda Park", "Robert Chen"];
        let suppliers = ["AeroTech Supplies", "Avionics Plus", "SkyParts Intl", "Precision Avio", "FastComp"];
        let buyers = ["Alice Brown", "Mark Spencer", "Sophia Reid", "David Zhou"];
        let errorTypes = ["Wrong documentation", "Missing documentation", "Wrong labeling", "Missing label", "Quantity discrepancy", "Wrong part number", "Damaged material", "Packaging issue", "SAP mismatch", "Other"];
        let recipients = [];
        let pendingAttachments = [];
        let pendingErrorTypes = [];
        let pendingRecipients = [];
        let emailIntro = '';

        let incidents = [];
        const statusBanner = document.getElementById('appStatus');
        let busy = false;
        const desktopApi = window.thalesDesktopAPI || null;

        const defaultReferences = {
            operators: [...operators],
            suppliers: [...suppliers],
            buyers: [...buyers],
            errorTypes: [...errorTypes],
            recipients: []
        };

        function setStatus(message, variant = 'info') {
            if (!statusBanner) return;
            if (!message) {
                statusBanner.style.display = 'none';
                statusBanner.textContent = '';
                statusBanner.className = 'app-status';
                return;
            }
            statusBanner.textContent = message;
            statusBanner.className = `app-status ${variant === 'info' ? '' : variant}`.trim();
            statusBanner.style.display = 'block';
        }

        function setBusyState(isBusy, message = '') {
            busy = isBusy;
            if (isBusy) setStatus(message || 'Synchronizing local data...');
        }

        function normalizeIncident(raw) {
            let status = raw.status || 'Open';
            if (raw.deletedAt) status = 'Deleted';
            else if (raw.resolvedAt) status = 'Resolved';

            return {
                deletedAt: null,
                deletedReason: '',
                referenceNotes: '',
                errorTypesSelected: [],
                attachments: [],
                recipients: [],
                ...raw,
                errorTypesSelected: Array.isArray(raw.errorTypesSelected) ? raw.errorTypesSelected : (raw.errorType ? String(raw.errorType).split(' | ').map((value) => value.trim()).filter(Boolean) : []),
                attachments: Array.isArray(raw.attachments) ? raw.attachments : [],
                recipients: Array.isArray(raw.recipients) ? raw.recipients : [],
                errorType: Array.isArray(raw.errorTypesSelected) && raw.errorTypesSelected.length ? raw.errorTypesSelected.join(' | ') : (raw.errorType || ''),
                status
            };
        }

        function safeJsonParse(value, fallback) {
            try {
                return JSON.parse(value);
            } catch {
                return fallback;
            }
        }

        function createIncidentId() {
            const stamp = Date.now().toString().slice(-6);
            const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
            return `INC-${stamp}-${random}`;
        }

        function getNowIso() {
            return new Date().toISOString();
        }

        function normalizeReferences(refs = {}) {
            return {
                operators: Array.isArray(refs.operators) && refs.operators.length ? refs.operators : [...defaultReferences.operators],
                suppliers: Array.isArray(refs.suppliers) && refs.suppliers.length ? refs.suppliers : [...defaultReferences.suppliers],
                buyers: Array.isArray(refs.buyers) && refs.buyers.length ? refs.buyers : [...defaultReferences.buyers],
                errorTypes: Array.isArray(refs.errorTypes) && refs.errorTypes.length ? refs.errorTypes : [...defaultReferences.errorTypes],
                recipients: Array.isArray(refs.recipients) ? refs.recipients.filter((recipient) => recipient && recipient.email) : []
            };
        }

        function createDefaultStore() {
            return {
                references: normalizeReferences(defaultReferences),
                settings: {
                    emailIntro: ''
                },
                incidents: []
            };
        }

        function assertRequiredFields(body, requiredFields) {
            for (const field of requiredFields) {
                if (!body[field] && body[field] !== 0) {
                    throw new Error(`Missing field: ${field}`);
                }
            }
        }

        function readFileAsDataUrl(file) {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = () => reject(new Error(`Unable to read attachment: ${file.name}`));
                reader.readAsDataURL(file);
            });
        }

        async function collectAttachments() {
            return pendingAttachments.slice();
        }

        function escapeHtml(value = '') {
            return String(value)
                .replaceAll('&', '&amp;')
                .replaceAll('<', '&lt;')
                .replaceAll('>', '&gt;')
                .replaceAll('"', '&quot;')
                .replaceAll("'", '&#39;');
        }

        function getIncidentErrorReasons(incident) {
            if (Array.isArray(incident?.errorTypesSelected) && incident.errorTypesSelected.length) {
                return incident.errorTypesSelected;
            }
            return incident?.errorType ? String(incident.errorType).split(' | ').map((value) => value.trim()).filter(Boolean) : [];
        }

        async function apiRequest(path, options = {}) {
            const config = {
                method: options.method || 'GET',
                headers: {}
            };

            if (options.body !== undefined) {
                config.headers['content-type'] = 'application/json';
                config.body = JSON.stringify(options.body);
            }

            const response = await fetch(path, config);
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(payload.error || `Request failed with status ${response.status}`);
            }
            return payload;
        }

        const storageAdapter = desktopApi ? {
            mode: 'desktop',
            bootstrap: () => desktopApi.bootstrap(),
            createIncident: (body) => desktopApi.createIncident(body),
            createIncidentEmailDraft: (id) => desktopApi.createIncidentEmailDraft(id),
            resolveIncident: (id) => desktopApi.resolveIncident(id),
            archiveIncident: (id, reason) => desktopApi.archiveIncident(id, reason),
            deleteIncidentPermanently: (id) => desktopApi.deleteIncidentPermanently(id),
            addReferenceItem: (categoryKey, value) => desktopApi.addReferenceItem(categoryKey, value),
            removeReferenceItem: (categoryKey, value) => desktopApi.removeReferenceItem(categoryKey, value),
            updateEmailIntro: (value) => desktopApi.updateEmailIntro(value)
        } : {
            mode: 'cloudflare',
            async bootstrap() {
                return apiRequest('/api/bootstrap');
            },
            async createIncidentEmailDraft(id) {
                const payload = await apiRequest(`/api/incidents/${id}/email-draft`);
                if (payload.mailtoUrl) {
                    window.location.href = payload.mailtoUrl;
                }
                return payload;
            },
            async createIncident(body) {
                assertRequiredFields(body, [
                    'operator',
                    'supplier',
                    'batchNumber',
                    'partNumber',
                    'quantity',
                    'buyer',
                    'errorType'
                ]);

                const quantity = Number(body.quantity);
                if (!Number.isInteger(quantity) || quantity <= 0) {
                    throw new Error('Quantity must be a positive integer.');
                }
                return apiRequest('/api/incidents', {
                    method: 'POST',
                    body
                });
            },
            async resolveIncident(id) {
                return apiRequest(`/api/incidents/${id}/resolve`, {
                    method: 'POST'
                });
            },
            async archiveIncident(id, reason) {
                return apiRequest(`/api/incidents/${id}/archive`, {
                    method: 'POST',
                    body: { reason }
                });
            },
            async deleteIncidentPermanently(id) {
                return apiRequest(`/api/incidents/${id}`, {
                    method: 'DELETE'
                });
            },
            async addReferenceItem(categoryKey, value) {
                return apiRequest(`/api/reference-data/${categoryKey}`, {
                    method: 'POST',
                    body: { value }
                });
            },
            async removeReferenceItem(categoryKey, value) {
                return apiRequest(`/api/reference-data/${categoryKey}`, {
                    method: 'DELETE',
                    body: { value }
                });
            },
            async updateEmailIntro(value) {
                return apiRequest('/api/settings/email-intro', {
                    method: 'POST',
                    body: { value }
                });
            }
        };

        async function loadAppData(showLoading = false) {
            try {
                const loadingMessage = storageAdapter.mode === 'desktop'
                    ? 'Loading local desktop data...'
                    : 'Loading persistent data from Cloudflare...';
                setBusyState(showLoading, loadingMessage);
                const data = await storageAdapter.bootstrap();
                operators = data.references?.operators || [];
                suppliers = data.references?.suppliers || [];
                buyers = data.references?.buyers || [];
                errorTypes = data.references?.errorTypes || [];
                recipients = data.references?.recipients || [];
                emailIntro = data.settings?.emailIntro || '';
                pendingErrorTypes = pendingErrorTypes.filter((value) => errorTypes.includes(value));
                pendingRecipients = pendingRecipients.filter((recipient) => recipients.some((item) => (item.id || item.email) === (recipient.id || recipient.email)));
                const emailIntroInput = document.getElementById('emailIntroInput');
                if (emailIntroInput) emailIntroInput.value = emailIntro;
                incidents = (data.incidents || []).map(normalizeIncident);
                refreshAll();
                const connectedMessage = storageAdapter.mode === 'desktop'
                    ? 'Desktop mode active. Data is persisted on this PC.'
                    : 'Cloudflare mode active. Data is persisted online.';
                setStatus(connectedMessage, 'success');
                setTimeout(() => {
                    if (!busy) setStatus('');
                }, 1800);
            } catch (err) {
                setStatus(`Cloudflare backend unavailable: ${err.message}`, 'error');
            } finally {
                setBusyState(false);
            }
        }
        function formatDuration(created, resolved){ const end=resolved?new Date(resolved):new Date(); const h=(end-new Date(created))/(1000*60*60); return h<1? Math.round(h*60)+' min' : h.toFixed(1)+' h'; }
        function getDurationClass(h){ if(h>=24) return 'critical'; if(h>=8) return 'warning'; return 'normal'; }

        let currentPeriod='all';
        function filterByPeriod(arr){ if(currentPeriod==='all') return arr; const limit=new Date(); limit.setDate(limit.getDate()-parseInt(currentPeriod)); return arr.filter(i=>new Date(i.createdAt)>=limit); }

        function setSelectValue(selectId, value) {
            const select = document.getElementById(selectId);
            if (!select || value === undefined || value === null) return;
            const normalizedValue = String(value);
            if ([...select.options].some((option) => option.value === normalizedValue)) {
                select.value = normalizedValue;
            }
        }

        // populate selects
        function populateSelects(){
            const currentSelections = {
                operator: document.getElementById('operatorSelect')?.value || '',
                supplier: document.getElementById('supplierSelect')?.value || '',
                buyer: document.getElementById('buyerSelect')?.value || '',
                errorType: document.getElementById('errorTypeSelect')?.value || '',
                recipient: document.getElementById('recipientSelect')?.value || '',
                filterSupplierOpen: document.getElementById('filterSupplierOpen')?.value || '',
                filterSupplierResolved: document.getElementById('filterSupplierResolved')?.value || '',
                filterSupplierDeleted: document.getElementById('filterSupplierDeleted')?.value || '',
                filterBuyerOpen: document.getElementById('filterBuyerOpen')?.value || '',
                filterBuyerResolved: document.getElementById('filterBuyerResolved')?.value || '',
                filterBuyerDeleted: document.getElementById('filterBuyerDeleted')?.value || '',
                filterErrorOpen: document.getElementById('filterErrorOpen')?.value || '',
                filterErrorResolved: document.getElementById('filterErrorResolved')?.value || '',
                filterErrorDeleted: document.getElementById('filterErrorDeleted')?.value || ''
            };

            document.querySelectorAll('#operatorSelect, #supplierSelect, #buyerSelect').forEach(s=>{ s.innerHTML='<option value="">-- Select --</option>'; });
            operators.forEach(v=>document.getElementById('operatorSelect').appendChild(new Option(v,v)));
            suppliers.forEach(v=>document.getElementById('supplierSelect').appendChild(new Option(v,v)));
            buyers.forEach(v=>document.getElementById('buyerSelect').appendChild(new Option(v,v)));
            const errorTypeSelect = document.getElementById('errorTypeSelect');
            if (errorTypeSelect) {
                errorTypeSelect.innerHTML = '<option value="">-- Select reason --</option>';
                errorTypes.forEach((value) => {
                    if (!pendingErrorTypes.includes(value)) {
                        errorTypeSelect.appendChild(new Option(value, value));
                    }
                });
            }
            const recipientSelect = document.getElementById('recipientSelect');
            if (recipientSelect) {
                recipientSelect.innerHTML = '<option value="">-- Select recipient --</option>';
                recipients.forEach((recipient) => {
                    const label = `${recipient.firstName || ''} ${recipient.lastName || ''}`.trim() || recipient.email;
                    if (!pendingRecipients.some((item) => (item.id || item.email) === (recipient.id || recipient.email))) {
                        recipientSelect.appendChild(new Option(`${label} <${recipient.email}>`, recipient.id || recipient.email));
                    }
                });
            }
            ['filterSupplierOpen','filterSupplierResolved','filterSupplierDeleted'].forEach(id=>{ const sel=document.getElementById(id); if(!sel) return; sel.innerHTML='<option value="">All suppliers</option>'; suppliers.forEach(s=>sel.appendChild(new Option(s,s))); });
            ['filterBuyerOpen','filterBuyerResolved','filterBuyerDeleted'].forEach(id=>{ const sel=document.getElementById(id); if(!sel) return; sel.innerHTML='<option value="">All buyers</option>'; buyers.forEach(b=>sel.appendChild(new Option(b,b))); });
            ['filterErrorOpen','filterErrorResolved','filterErrorDeleted'].forEach(id=>{ const sel=document.getElementById(id); if(!sel) return; sel.innerHTML='<option value="">All errors</option>'; errorTypes.forEach(e=>sel.appendChild(new Option(e,e))); });

            setSelectValue('operatorSelect', currentSelections.operator);
            setSelectValue('supplierSelect', currentSelections.supplier);
            setSelectValue('buyerSelect', currentSelections.buyer);
            setSelectValue('errorTypeSelect', currentSelections.errorType);
            setSelectValue('recipientSelect', currentSelections.recipient);
            setSelectValue('filterSupplierOpen', currentSelections.filterSupplierOpen);
            setSelectValue('filterSupplierResolved', currentSelections.filterSupplierResolved);
            setSelectValue('filterSupplierDeleted', currentSelections.filterSupplierDeleted);
            setSelectValue('filterBuyerOpen', currentSelections.filterBuyerOpen);
            setSelectValue('filterBuyerResolved', currentSelections.filterBuyerResolved);
            setSelectValue('filterBuyerDeleted', currentSelections.filterBuyerDeleted);
            setSelectValue('filterErrorOpen', currentSelections.filterErrorOpen);
            setSelectValue('filterErrorResolved', currentSelections.filterErrorResolved);
            setSelectValue('filterErrorDeleted', currentSelections.filterErrorDeleted);
        }

        function renderPendingAttachments() {
            const container = document.getElementById('pendingAttachmentList');
            if (!container) return;
            if (!pendingAttachments.length) {
                container.innerHTML = '<div class="text-muted">No attachments selected yet.</div>';
                return;
            }

            container.innerHTML = pendingAttachments.map((attachment) => `
                <div class="action-stack">
                    <span>${escapeHtml(attachment.name)} <span class="text-muted">(${Math.max(1, Math.round((attachment.size || 0) / 1024))} KB)</span></span>
                    <button type="button" class="secondary small" data-remove-pending-attachment="${attachment.id}">Remove</button>
                </div>
            `).join('');
        }

        function renderPendingRecipients() {
            const container = document.getElementById('selectedRecipientList');
            if (!container) return;
            if (!pendingRecipients.length) {
                container.innerHTML = '<div class="text-muted">No recipients selected yet.</div>';
                return;
            }

            container.innerHTML = pendingRecipients.map((recipient) => {
                const label = `${recipient.firstName || ''} ${recipient.lastName || ''}`.trim() || recipient.email;
                return `
                    <div class="action-stack">
                        <span>${escapeHtml(label)} &lt;${escapeHtml(recipient.email)}&gt;</span>
                        <button type="button" class="secondary small" data-remove-pending-recipient="${recipient.id || recipient.email}">Remove</button>
                    </div>
                `;
            }).join('');
        }

        function renderPendingErrorTypes() {
            const container = document.getElementById('selectedErrorTypeList');
            if (!container) return;
            if (!pendingErrorTypes.length) {
                container.innerHTML = '<div class="text-muted">No rejection reasons selected yet.</div>';
                return;
            }

            container.innerHTML = pendingErrorTypes.map((value) => `
                <div class="action-stack">
                    <span>${escapeHtml(value)}</span>
                    <button type="button" class="secondary small" data-remove-pending-error-type="${escapeHtml(value)}">Remove</button>
                </div>
            `).join('');
        }

        function checkDuplicate(batch,part,supplier,error){
            const normalizedError = Array.isArray(error) ? error.slice().sort().join(' | ') : error;
            const existing = incidents.find(i=>i.status==='Open' && i.batchNumber===batch && i.partNumber===part && i.supplier===supplier && getIncidentErrorReasons(i).slice().sort().join(' | ')===normalizedError);
            return existing ? existing.id : null;
        }

        const paginationState = {
            open: { page: 1, pageSize: 25 },
            resolved: { page: 1, pageSize: 25 },
            deleted: { page: 1, pageSize: 25 }
        };

        function paginateList(items, key) {
            const state = paginationState[key];
            const total = items.length;
            const pageCount = Math.max(1, Math.ceil(total / state.pageSize));
            if (state.page > pageCount) state.page = pageCount;
            if (state.page < 1) state.page = 1;
            const start = (state.page - 1) * state.pageSize;
            const end = start + state.pageSize;
            return {
                items: items.slice(start, end),
                total,
                start: total ? start + 1 : 0,
                end: Math.min(end, total),
                page: state.page,
                pageCount
            };
        }

        function updatePaginationUi(key, meta) {
            const summary = document.getElementById(`${key}ResultsSummary`);
            const indicator = document.getElementById(`${key}PageIndicator`);
            const prevBtn = document.querySelector(`[data-page-action="prev"][data-page-target="${key}"]`);
            const nextBtn = document.querySelector(`[data-page-action="next"][data-page-target="${key}"]`);
            if (summary) summary.textContent = meta.total ? `${meta.start}-${meta.end} of ${meta.total} results` : '0 results';
            if (indicator) indicator.textContent = `Page ${meta.page} / ${meta.pageCount}`;
            if (prevBtn) prevBtn.disabled = meta.page <= 1;
            if (nextBtn) nextBtn.disabled = meta.page >= meta.pageCount;
        }

        function resetPage(key) {
            paginationState[key].page = 1;
        }

        let pendingDeleteId = null;

        function renderIncidentAttachments(attachments) {
            if (!attachments || !attachments.length) {
                return '<div class="text-muted">No attachments.</div>';
            }

            return attachments.map((attachment) => `
                <a class="attachment-link" href="${attachment.dataUrl}" download="${escapeHtml(attachment.name)}">
                    <i class="fas fa-paperclip"></i>
                    <span>${escapeHtml(attachment.name)}</span>
                    <span class="text-muted">(${Math.max(1, Math.round((attachment.size || 0) / 1024))} KB)</span>
                </a>
            `).join('');
        }

        function openCommentModalForIncident(metaText, incident) {
            const modal = document.getElementById('commentModal');
            const meta = document.getElementById('commentMeta');
            const text = document.getElementById('commentModalText');
            const referenceText = document.getElementById('commentReferenceText');
            const attachmentList = document.getElementById('commentAttachmentList');
            const recipientsText = document.getElementById('commentRecipientsText');
            const archiveReasonBlock = document.getElementById('commentArchiveReasonBlock');
            const archiveReasonText = document.getElementById('commentArchiveReasonText');
            if (!modal || !meta || !text || !referenceText || !attachmentList || !archiveReasonBlock || !archiveReasonText || !recipientsText) return;
            meta.textContent = metaText || '—';
            text.textContent = incident?.comment || 'No comment recorded.';
            referenceText.textContent = incident?.referenceNotes || 'No reference or evidence recorded.';
            recipientsText.textContent = (incident?.recipients || []).length
                ? incident.recipients.map((recipient) => `${recipient.firstName || ''} ${recipient.lastName || ''}`.trim() ? `${`${recipient.firstName || ''} ${recipient.lastName || ''}`.trim()} <${recipient.email}>` : recipient.email).join(', ')
                : 'No recipient recorded.';
            attachmentList.innerHTML = renderIncidentAttachments(incident?.attachments || []);
            if (incident?.deletedReason) {
                archiveReasonBlock.style.display = 'grid';
                archiveReasonText.textContent = incident.deletedReason;
            } else {
                archiveReasonBlock.style.display = 'none';
                archiveReasonText.textContent = '—';
            }
            modal.style.display = 'flex';
            modal.setAttribute('aria-hidden', 'false');
        }

        function closeCommentModalForIncident() {
            const modal = document.getElementById('commentModal');
            if (!modal) return;
            modal.style.display = 'none';
            modal.setAttribute('aria-hidden', 'true');
        }

        function openDeleteModal(id) {
            const inc = incidents.find(i => i.id === id);
            if (!inc) return;
            pendingDeleteId = id;
            const modal = document.getElementById('deleteModal');
            const meta = document.getElementById('deleteIncidentMeta');
            const reason = document.getElementById('deleteReason');
            if (meta) meta.textContent = `${inc.id} · ${inc.supplier} · ${inc.batchNumber} · ${inc.partNumber}`;
            if (reason) reason.value = '';
            if (modal) { modal.style.display = 'flex'; modal.setAttribute('aria-hidden', 'false'); }
        }

        function closeDeleteModal() {
            pendingDeleteId = null;
            const modal = document.getElementById('deleteModal');
            const reason = document.getElementById('deleteReason');
            if (reason) reason.value = '';
            if (modal) { modal.style.display = 'none'; modal.setAttribute('aria-hidden', 'true'); }
        }

        function archiveIncident() {
            if (!pendingDeleteId) return;
            const inc = incidents.find(i => i.id === pendingDeleteId);
            const reason = (document.getElementById('deleteReason')?.value || '').trim();
            if (!inc) return;
            if (!reason) { alert('A reason is required before archiving this incident.'); return; }
            return storageAdapter.archiveIncident(pendingDeleteId, reason).then(async () => {
                closeDeleteModal();
                await loadAppData();
            }).catch((err) => {
                setStatus(err.message, 'error');
            });
        }

        async function deleteIncidentPermanently(id) {
            const incident = incidents.find((item) => item.id === id);
            if (!incident) return;
            if (!confirm(`This action permanently deletes incident ${id} and cannot be undone. Continue?`)) return;
            await storageAdapter.deleteIncidentPermanently(id);
            await loadAppData();
        }

        // RENDER OPEN
        function renderOpen(){
            const tbody=document.querySelector('#openIncidentsTable tbody');
            let open=incidents.filter(i=>i.status==='Open');
            const sup=document.getElementById('filterSupplierOpen').value, buy=document.getElementById('filterBuyerOpen').value, err=document.getElementById('filterErrorOpen').value;
            if(sup) open=open.filter(i=>i.supplier===sup); if(buy) open=open.filter(i=>i.buyer===buy); if(err) open=open.filter(i=>getIncidentErrorReasons(i).includes(err));
            open.sort((a,b)=>new Date(a.createdAt)-new Date(b.createdAt));
            const pageMeta = paginateList(open, 'open');
            tbody.innerHTML='';
            pageMeta.items.forEach(inc=>{
                const tr=document.createElement('tr'); const h=(new Date()-new Date(inc.createdAt))/(1000*60*60);
                tr.innerHTML=`<td><code>${inc.id}</code></td><td>${new Date(inc.createdAt).toLocaleString()}</td><td>${inc.operator}</td><td>${inc.supplier}</td><td>${inc.buyer}</td><td>${inc.batchNumber}</td><td>${inc.partNumber}</td><td>${inc.quantity}</td><td>${inc.errorType}</td><td><span class="status-badge ${getDurationClass(h)}">${formatDuration(inc.createdAt,null)}</span></td><td><div class="action-stack"><button class="view-btn small" data-view-comment="${inc.id}"><i class="fas fa-eye"></i> Details</button><button class="resolve-btn small" data-id="${inc.id}"><i class="fas fa-check"></i> Resolve</button><button class="delete-btn small" data-delete-id="${inc.id}"><i class="fas fa-box-archive"></i> Archive</button><button class="danger-btn small" data-purge-id="${inc.id}"><i class="fas fa-trash"></i> Delete</button></div></td>`;
                tbody.appendChild(tr);
            });
            document.getElementById('openCountBadge').textContent=open.length;
            updatePaginationUi('open', pageMeta);
        }
        async function resolveIncident(id){
            await storageAdapter.resolveIncident(id);
            await loadAppData();
        }

        // RENDER RESOLVED
        let lastResolvedFiltered = [];
        function getFilteredResolved(){
            let resolved=incidents.filter(i=>i.status==='Resolved');
            const search=document.getElementById('searchResolved').value.toLowerCase(), sup=document.getElementById('filterSupplierResolved').value, buy=document.getElementById('filterBuyerResolved').value, err=document.getElementById('filterErrorResolved').value;
            if(sup) resolved=resolved.filter(i=>i.supplier===sup); if(buy) resolved=resolved.filter(i=>i.buyer===buy); if(err) resolved=resolved.filter(i=>getIncidentErrorReasons(i).includes(err));
            if(search) resolved=resolved.filter(i=>i.batchNumber.toLowerCase().includes(search)||i.partNumber.toLowerCase().includes(search)||i.supplier.toLowerCase().includes(search));
            return resolved.sort((a,b)=>new Date(b.resolvedAt)-new Date(a.resolvedAt));
        }
        function renderResolved(){
            const tbody=document.querySelector('#resolvedTable tbody');
            const list = getFilteredResolved(); lastResolvedFiltered = list;
            const pageMeta = paginateList(list, 'resolved');
            tbody.innerHTML='';
            pageMeta.items.forEach(inc=>{ const dur=(new Date(inc.resolvedAt)-new Date(inc.createdAt))/(1000*60*60);
                const tr=document.createElement('tr'); tr.innerHTML=`<td>${inc.id}</td><td>${new Date(inc.createdAt).toLocaleString()}</td><td>${new Date(inc.resolvedAt).toLocaleString()}</td><td>${dur.toFixed(1)}</td><td>${inc.supplier}</td><td>${inc.buyer}</td><td>${inc.errorType}</td><td>${inc.batchNumber}</td><td>${inc.partNumber}</td><td>${inc.quantity}</td><td>${inc.operator}</td><td><div class="action-stack"><span class="comment-preview">${inc.comment||'—'}</span><button class="view-btn small" data-view-comment="${inc.id}"><i class="fas fa-eye"></i> View</button><button class="danger-btn small" data-purge-id="${inc.id}"><i class="fas fa-trash"></i> Delete</button></div></td>`;
                tbody.appendChild(tr); });
            document.getElementById('resolvedCountBadge').textContent=list.length;
            updatePaginationUi('resolved', pageMeta);
        }

        function getFilteredDeleted(){
            let deleted=incidents.filter(i=>i.status==='Deleted');
            const search=(document.getElementById('searchDeleted')?.value||'').toLowerCase(), sup=document.getElementById('filterSupplierDeleted')?.value, buy=document.getElementById('filterBuyerDeleted')?.value, err=document.getElementById('filterErrorDeleted')?.value;
            if(sup) deleted=deleted.filter(i=>i.supplier===sup); if(buy) deleted=deleted.filter(i=>i.buyer===buy); if(err) deleted=deleted.filter(i=>getIncidentErrorReasons(i).includes(err));
            if(search) deleted=deleted.filter(i=>i.batchNumber.toLowerCase().includes(search)||i.partNumber.toLowerCase().includes(search)||i.supplier.toLowerCase().includes(search));
            return deleted.sort((a,b)=>new Date(b.deletedAt)-new Date(a.deletedAt));
        }

        function renderDeleted(){
            const tbody=document.querySelector('#deletedTable tbody');
            if(!tbody) return;
            const list=getFilteredDeleted();
            const pageMeta = paginateList(list, 'deleted');
            tbody.innerHTML='';
            pageMeta.items.forEach(inc=>{
                const tr=document.createElement('tr');
                tr.innerHTML=`<td>${inc.id}</td><td>${new Date(inc.createdAt).toLocaleString()}</td><td>${inc.deletedAt?new Date(inc.deletedAt).toLocaleString():'—'}</td><td>${inc.supplier}</td><td>${inc.buyer}</td><td>${inc.errorType}</td><td>${inc.batchNumber}</td><td>${inc.partNumber}</td><td>${inc.quantity}</td><td><div class="action-stack"><span class="comment-preview">${inc.comment||'—'}</span><button class="view-btn small" data-view-comment="${inc.id}"><i class="fas fa-eye"></i> View</button></div></td><td><div class="action-stack"><span class="comment-preview">${inc.deletedReason||'—'}</span><button class="view-btn small" data-view-delete-reason="${inc.id}"><i class="fas fa-eye"></i> View</button><button class="danger-btn small" data-purge-id="${inc.id}"><i class="fas fa-trash"></i> Delete</button></div></td>`;
                tbody.appendChild(tr);
            });
            document.getElementById('deletedCountBadge').textContent=list.length;
            updatePaginationUi('deleted', pageMeta);
        }

        // DASHBOARD
        function renderDashboard(){
            const activePool=incidents.filter(i=>i.status!=='Deleted');
            const filtered=filterByPeriod(activePool);
            const resolvedFiltered=filtered.filter(i=>i.status==='Resolved');
            const openCount=filtered.filter(i=>i.status==='Open').length;
            let avg=0, median=0, totalBlocked=0;
            if(resolvedFiltered.length){
                const durs=resolvedFiltered.map(i=>(new Date(i.resolvedAt)-new Date(i.createdAt))/(1000*60*60));
                avg=durs.reduce((a,b)=>a+b,0)/durs.length;
                durs.sort((a,b)=>a-b); const mid=Math.floor(durs.length/2);
                median=durs.length%2?durs[mid]:(durs[mid-1]+durs[mid])/2;
                totalBlocked=durs.reduce((a,b)=>a+b,0);
            }
            document.getElementById('kpiContainer').innerHTML=`
                <div class="kpi-card"><div class="kpi-value">${filtered.length}</div><div class="kpi-label">Total incidents</div></div>
                <div class="kpi-card"><div class="kpi-value">${openCount}</div><div class="kpi-label">Open</div></div>
                <div class="kpi-card"><div class="kpi-value">${avg.toFixed(1)} h</div><div class="kpi-label">Avg resolution</div></div>
                <div class="kpi-card"><div class="kpi-value">${median.toFixed(1)} h</div><div class="kpi-label">Median resolution</div></div>
                <div class="kpi-card"><div class="kpi-value">${totalBlocked.toFixed(0)} h</div><div class="kpi-label">Total blocked time</div></div>`;
            updateCharts(filtered, resolvedFiltered);
            updateSummaryTables(filtered, resolvedFiltered);
            updateInsightBox(filtered, resolvedFiltered);
        }

        function updateInsightBox(all, resolved){
            const openSorted = all.filter(i=>i.status==='Open').sort((a,b)=>new Date(a.createdAt)-new Date(b.createdAt));
            const oldest = openSorted[0];
            const supCount = new Map(); all.forEach(i=>supCount.set(i.supplier,(supCount.get(i.supplier)||0)+1));
            const topSup = Array.from(supCount.entries()).sort((a,b)=>b[1]-a[1])[0];
            const errAvg = new Map(); resolved.forEach(i=>{ const d=(new Date(i.resolvedAt)-new Date(i.createdAt))/(1000*60*60); getIncidentErrorReasons(i).forEach((reason)=>{ if(!errAvg.has(reason)) errAvg.set(reason,{sum:0,count:0}); const r=errAvg.get(reason); r.sum+=d; r.count++; }); });
            let worstErr=null, worstAvg=0; errAvg.forEach((v,k)=>{ const a=v.sum/v.count; if(a>worstAvg){ worstAvg=a; worstErr=k; } });
            document.getElementById('insightBox').innerHTML=`
                <div class="insight-item"><span class="insight-label"><i class="fas fa-industry"></i> Top supplier (count)</span><span class="insight-value">${topSup?topSup[0]:'—'} (${topSup?topSup[1]:0})</span></div>
                <div class="insight-item"><span class="insight-label"><i class="fas fa-clock"></i> Longest avg resolution</span><span class="insight-value">${worstErr||'—'} (${worstAvg.toFixed(1)} h)</span></div>
                <div class="insight-item"><span class="insight-label"><i class="fas fa-hourglass-start"></i> Oldest open incident</span><span class="insight-value">${oldest?oldest.id+' · '+formatDuration(oldest.createdAt,null):'none'}</span></div>`;
        }

        let charts={};
        function updateCharts(all, resolved){
            const supMap=new Map(), errMap=new Map(), buyMap=new Map(), supTime=new Map(), errTime=new Map();
            all.forEach(i=>{ supMap.set(i.supplier,(supMap.get(i.supplier)||0)+1); getIncidentErrorReasons(i).forEach((reason)=>errMap.set(reason,(errMap.get(reason)||0)+1)); buyMap.set(i.buyer,(buyMap.get(i.buyer)||0)+1); });
            resolved.forEach(i=>{ const d=(new Date(i.resolvedAt)-new Date(i.createdAt))/(1000*60*60); supTime.set(i.supplier,(supTime.get(i.supplier)||0)+d);
                getIncidentErrorReasons(i).forEach((reason)=>{ if(!errTime.has(reason)) errTime.set(reason,{sum:0,count:0}); const r=errTime.get(reason); r.sum+=d; r.count++; }); });
            const supSorted=[...supMap].sort((a,b)=>b[1]-a[1]).slice(0,7);
            const errSorted=[...errMap].sort((a,b)=>b[1]-a[1]);
            const buySorted=[...buyMap].sort((a,b)=>b[1]-a[1]).slice(0,7);
            const timeSupSorted=[...supTime].sort((a,b)=>b[1]-a[1]).slice(0,7);
            const errAvgSorted=[...errTime].map(([e,{sum,count}])=>[e,sum/count]).sort((a,b)=>b[1]-a[1]);
            const weekly=getWeekly(all);
            if(charts.sup) charts.sup.destroy(); if(charts.err) charts.err.destroy(); if(charts.buy) charts.buy.destroy(); if(charts.time) charts.time.destroy(); if(charts.avgErr) charts.avgErr.destroy(); if(charts.over) charts.over.destroy();
            charts.sup=new Chart(document.getElementById('chartSupplier'),{type:'bar',data:{labels:supSorted.map(s=>s[0]),datasets:[{label:'Incidents',data:supSorted.map(s=>s[1]),backgroundColor:'#2563eb'}]}});
            charts.err=new Chart(document.getElementById('chartErrorType'),{type:'bar',data:{labels:errSorted.map(e=>e[0]),datasets:[{label:'Count',data:errSorted.map(e=>e[1]),backgroundColor:'#d97706'}]}});
            charts.buy=new Chart(document.getElementById('chartBuyer'),{type:'bar',data:{labels:buySorted.map(b=>b[0]),datasets:[{label:'Incidents',data:buySorted.map(b=>b[1]),backgroundColor:'#7c3aed'}]}});
            charts.time=new Chart(document.getElementById('chartTimeLostSupplier'),{type:'bar',data:{labels:timeSupSorted.map(t=>t[0]),datasets:[{label:'Blocked hours',data:timeSupSorted.map(t=>t[1]),backgroundColor:'#0d9488'}]}});
            charts.avgErr=new Chart(document.getElementById('chartAvgTimeError'),{type:'bar',data:{labels:errAvgSorted.map(e=>e[0]),datasets:[{label:'Avg hours',data:errAvgSorted.map(e=>e[1]),backgroundColor:'#b45309'}]}});
            charts.over=new Chart(document.getElementById('chartOverTime'),{type:'line',data:{labels:weekly.labels,datasets:[{label:'Incidents per week',data:weekly.counts,borderColor:'#2563eb',tension:0.2}]}});
        }
        function getWeekly(inc){ const w={}; inc.forEach(i=>{ const d=new Date(i.createdAt); const week=`${d.getFullYear()}-W${getWeek(d)}`; w[week]=(w[week]||0)+1; }); const sorted=Object.keys(w).sort(); return {labels:sorted, counts:sorted.map(k=>w[k])}; }
        function getWeek(d){ d=new Date(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate())); d.setUTCDate(d.getUTCDate()+4-(d.getUTCDay()||7)); const y=new Date(Date.UTC(d.getUTCFullYear(),0,1)); return Math.ceil((((d-y)/86400000)+1)/7); }

        function updateSummaryTables(all, resolved){
            const supMap=new Map(), errMap=new Map(), buyMap=new Map(), supTime=new Map(), errTime=new Map(), buyResolvedCount=new Map(), buyTime=new Map();
            all.forEach(i=>{ supMap.set(i.supplier,(supMap.get(i.supplier)||0)+1); getIncidentErrorReasons(i).forEach((reason)=>errMap.set(reason,(errMap.get(reason)||0)+1)); buyMap.set(i.buyer,(buyMap.get(i.buyer)||0)+1); });
            resolved.forEach(i=>{ const d=(new Date(i.resolvedAt)-new Date(i.createdAt))/(1000*60*60); supTime.set(i.supplier,(supTime.get(i.supplier)||0)+d); buyResolvedCount.set(i.buyer,(buyResolvedCount.get(i.buyer)||0)+1); buyTime.set(i.buyer,(buyTime.get(i.buyer)||0)+d);
                getIncidentErrorReasons(i).forEach((reason)=>{ if(!errTime.has(reason)) errTime.set(reason,{sum:0,count:0}); const r=errTime.get(reason); r.sum+=d; r.count++; }); });
            const supRows=[...supMap].map(([s,total])=>({supplier:s, total, open:all.filter(i=>i.supplier===s&&i.status==='Open').length, resolved: resolved.filter(i=>i.supplier===s).length, avg: supTime.has(s)? supTime.get(s)/resolved.filter(i=>i.supplier===s).length :0, blocked:supTime.get(s)||0})).sort((a,b)=>b.total-a.total);
            let htmlSup='<table><tr><th>Supplier</th><th>Total</th><th>Open</th><th>Avg(h)</th><th>Blocked(h)</th></tr>';
            supRows.slice(0,6).forEach(r=>htmlSup+=`<tr><td>${r.supplier}</td><td>${r.total}</td><td>${r.open}</td><td>${r.avg.toFixed(1)}</td><td>${r.blocked.toFixed(1)}</td></tr>`); htmlSup+='</table>'; document.getElementById('supplierSummaryTable').innerHTML=htmlSup;
            const errRows=[...errMap].map(([e,c])=>{ const rec=errTime.get(e); const avg=rec?rec.sum/rec.count:0; return {error:e, count:c, avg, blocked:rec?rec.sum:0}; }).sort((a,b)=>b.count-a.count);
            let htmlErr='<table><tr><th>Error</th><th>Count</th><th>Avg(h)</th><th>Blocked(h)</th></tr>';
            errRows.slice(0,6).forEach(r=>htmlErr+=`<tr><td>${r.error}</td><td>${r.count}</td><td>${r.avg.toFixed(1)}</td><td>${r.blocked.toFixed(1)}</td></tr>`); htmlErr+='</table>'; document.getElementById('errorSummaryTable').innerHTML=htmlErr;
            const buyRows=[...buyMap].map(([b,total])=>({buyer:b, total, resolved: buyResolvedCount.get(b)||0, avg: buyTime.has(b)? buyTime.get(b)/(buyResolvedCount.get(b)||1) :0, blocked:buyTime.get(b)||0})).sort((a,b)=>b.total-a.total);
            let htmlBuy='<table><tr><th>Buyer</th><th>Total</th><th>Resolved</th><th>Avg(h)</th><th>Blocked(h)</th></tr>';
            buyRows.slice(0,6).forEach(r=>htmlBuy+=`<tr><td>${r.buyer}</td><td>${r.total}</td><td>${r.resolved}</td><td>${r.avg.toFixed(1)}</td><td>${r.blocked.toFixed(1)}</td></tr>`); htmlBuy+='</table>'; document.getElementById('buyerSummaryTable').innerHTML=htmlBuy;
        }

        function refreshAll(){ populateSelects(); renderOpen(); renderResolved(); renderDeleted(); renderDashboard(); updateListDisplay(); }
        function updateListDisplay(){
            document.getElementById('operatorListDisplay').innerHTML=operators.map(o=>`<li class="action-stack"><span>${escapeHtml(o)}</span><button type="button" class="icon-only-btn" title="Delete" aria-label="Delete" data-remove-reference="operators" data-remove-value="${escapeHtml(o)}"><i class="fas fa-times"></i></button></li>`).join('');
            document.getElementById('supplierListDisplay').innerHTML=suppliers.map(s=>`<li class="action-stack"><span>${escapeHtml(s)}</span><button type="button" class="icon-only-btn" title="Delete" aria-label="Delete" data-remove-reference="suppliers" data-remove-value="${escapeHtml(s)}"><i class="fas fa-times"></i></button></li>`).join('');
            document.getElementById('buyerListDisplay').innerHTML=buyers.map(b=>`<li class="action-stack"><span>${escapeHtml(b)}</span><button type="button" class="icon-only-btn" title="Delete" aria-label="Delete" data-remove-reference="buyers" data-remove-value="${escapeHtml(b)}"><i class="fas fa-times"></i></button></li>`).join('');
            document.getElementById('errorListDisplay').innerHTML=errorTypes.map(e=>`<li class="action-stack"><span>${escapeHtml(e)}</span><button type="button" class="icon-only-btn" title="Delete" aria-label="Delete" data-remove-reference="errorTypes" data-remove-value="${escapeHtml(e)}"><i class="fas fa-times"></i></button></li>`).join('');
            document.getElementById('recipientListDisplay').innerHTML=recipients.map(r=>`<li class="action-stack"><span>${escapeHtml(`${r.firstName || ''} ${r.lastName || ''}`.trim() || 'Recipient')} &lt;${escapeHtml(r.email)}&gt;</span><button type="button" class="icon-only-btn" title="Delete" aria-label="Delete" data-remove-recipient-email="${escapeHtml(r.email)}"><i class="fas fa-times"></i></button></li>`).join('');
            renderPendingErrorTypes();
            renderPendingRecipients();
            renderPendingAttachments();
        }
        // events
        document.getElementById('incidentForm').addEventListener('submit',async e=>{ e.preventDefault();
            const op=document.getElementById('operatorSelect').value, sup=document.getElementById('supplierSelect').value, batch=document.getElementById('batchNumber').value.trim(), part=document.getElementById('partNumber').value.trim(), qty=+document.getElementById('quantity').value, comment=document.getElementById('comment').value.trim(), referenceNotes=document.getElementById('referenceNotes').value.trim();
            const err = pendingErrorTypes.slice();
            const selectedRecipients = pendingRecipients.slice();
            const buyer = document.getElementById('buyerSelect').value;
            if(!op||!sup||!batch||!part||!qty||!buyer||!err.length||!selectedRecipients.length) { alert('All required fields must be filled.'); return; }
            const dupId = checkDuplicate(batch,part,sup,err);
            if(dupId && !confirm(`Similar open incident ${dupId} exists. Create anyway?`)) return;
            try {
                setBusyState(true, 'Creating incident...');
                const attachments = await collectAttachments();
                const result = await storageAdapter.createIncident({ operator: op, supplier: sup, batchNumber: batch, partNumber: part, quantity: qty, buyer, errorType: err.join(' | '), errorTypesSelected: err, comment, referenceNotes, attachments, recipients: selectedRecipients });
                try {
                    const draft = await storageAdapter.createIncidentEmailDraft(result.id);
                    setStatus(
                        draft.warning
                            ? `Incident created. Email draft opened in your mail client. ${draft.warning}`
                            : 'Incident created and email draft opened.',
                        'success'
                    );
                } catch (draftError) {
                    setStatus(`Incident created, but the email draft could not be opened: ${draftError.message}`, 'error');
                }
                e.target.reset();
                pendingAttachments = [];
                pendingErrorTypes = [];
                pendingRecipients = [];
                await loadAppData();
            } catch (err) {
                setStatus(err.message, 'error');
            } finally {
                setBusyState(false);
            }
        });
        document.getElementById('toggleListManagerBtn').addEventListener('click',()=>{ const p=document.getElementById('listManagerPanel'); p.style.display=p.style.display==='none'?'block':'none'; });
        document.getElementById('addErrorTypeToIncidentBtn')?.addEventListener('click', () => {
            const value = document.getElementById('errorTypeSelect').value;
            if (!value) return;
            if (!pendingErrorTypes.includes(value)) {
                pendingErrorTypes.push(value);
                populateSelects();
                renderPendingErrorTypes();
            }
        });
        document.getElementById('addRecipientToIncidentBtn')?.addEventListener('click', () => {
            const recipientId = document.getElementById('recipientSelect').value;
            if (!recipientId) return;
            const recipient = recipients.find((item) => (item.id || item.email) === recipientId);
            if (!recipient) return;
            if (!pendingRecipients.some((item) => (item.id || item.email) === (recipient.id || recipient.email))) {
                pendingRecipients.push(recipient);
                populateSelects();
                renderPendingRecipients();
            }
        });
        document.getElementById('incidentAttachments')?.addEventListener('change', async (e) => {
            const files = Array.from(e.target.files || []);
            if (!files.length) return;
            try {
                const newAttachments = await Promise.all(files.map(async (file, index) => ({
                    id: `${Date.now()}-${index}-${Math.random().toString(16).slice(2, 8)}`,
                    name: file.name,
                    type: file.type || 'application/octet-stream',
                    size: file.size || 0,
                    dataUrl: await readFileAsDataUrl(file)
                })));
                pendingAttachments = [...pendingAttachments, ...newAttachments];
                renderPendingAttachments();
                e.target.value = '';
            } catch (err) {
                setStatus(err.message, 'error');
            }
        });
        async function addRef(categoryKey, inputId){
            const input = document.getElementById(inputId);
            const value = input.value.trim();
            if (!value) return;
            try {
                const response = await storageAdapter.addReferenceItem(categoryKey, value);
                operators = response.references?.operators || operators;
                suppliers = response.references?.suppliers || suppliers;
                buyers = response.references?.buyers || buyers;
                errorTypes = response.references?.errorTypes || errorTypes;
                input.value = '';
                refreshAll();
            } catch (err) {
                setStatus(err.message, 'error');
            }
        }
        document.getElementById('addOperatorBtn').addEventListener('click',()=>addRef('operators','newOperatorInput'));
        document.getElementById('addSupplierBtn').addEventListener('click',()=>addRef('suppliers','newSupplierInput'));
        document.getElementById('addBuyerBtn').addEventListener('click',()=>addRef('buyers','newBuyerInput'));
        document.getElementById('addErrorBtn').addEventListener('click',()=>addRef('errorTypes','newErrorInput'));
        document.getElementById('addRecipientBtn').addEventListener('click', async ()=>{
            const firstName = document.getElementById('newRecipientFirstName').value.trim();
            const lastName = document.getElementById('newRecipientLastName').value.trim();
            const email = document.getElementById('newRecipientEmail').value.trim();
            if (!email) { setStatus('Recipient email is required.', 'error'); return; }
            try {
                const response = await storageAdapter.addReferenceItem('recipients', { firstName, lastName, email });
                recipients = response.references?.recipients || recipients;
                document.getElementById('newRecipientFirstName').value = '';
                document.getElementById('newRecipientLastName').value = '';
                document.getElementById('newRecipientEmail').value = '';
                refreshAll();
            } catch (err) {
                setStatus(err.message, 'error');
            }
        });
        document.getElementById('saveEmailIntroBtn').addEventListener('click', async ()=>{
            const value = document.getElementById('emailIntroInput').value;
            try {
                const response = await storageAdapter.updateEmailIntro(value);
                emailIntro = response.settings?.emailIntro || '';
                setStatus('Email draft intro saved.', 'success');
            } catch (err) {
                setStatus(err.message, 'error');
            }
        });
        document.querySelectorAll('.period-btn').forEach(b=>b.addEventListener('click',function(){ document.querySelectorAll('.period-btn').forEach(x=>x.classList.remove('active')); this.classList.add('active'); currentPeriod=this.dataset.period; renderDashboard(); }));
        document.getElementById('filterSupplierOpen').addEventListener('change',()=>{ resetPage('open'); renderOpen(); }); document.getElementById('filterBuyerOpen').addEventListener('change',()=>{ resetPage('open'); renderOpen(); }); document.getElementById('filterErrorOpen').addEventListener('change',()=>{ resetPage('open'); renderOpen(); });
        document.getElementById('clearFiltersOpen').addEventListener('click',()=>{ document.getElementById('filterSupplierOpen').value=''; document.getElementById('filterBuyerOpen').value=''; document.getElementById('filterErrorOpen').value=''; resetPage('open'); renderOpen(); });
        document.getElementById('searchResolved').addEventListener('input',()=>{ resetPage('resolved'); renderResolved(); }); document.getElementById('filterSupplierResolved').addEventListener('change',()=>{ resetPage('resolved'); renderResolved(); }); document.getElementById('filterBuyerResolved').addEventListener('change',()=>{ resetPage('resolved'); renderResolved(); }); document.getElementById('filterErrorResolved').addEventListener('change',()=>{ resetPage('resolved'); renderResolved(); });
        document.getElementById('clearResolvedFilters').addEventListener('click',()=>{ document.getElementById('searchResolved').value=''; document.getElementById('filterSupplierResolved').value=''; document.getElementById('filterBuyerResolved').value=''; document.getElementById('filterErrorResolved').value=''; resetPage('resolved'); renderResolved(); });
        document.addEventListener('click', async (e) => {
            const button = e.target.closest('button');
            const backdrop = e.target.classList.contains('modal-backdrop') ? e.target : null;

            if (button?.dataset.id) {
                if(!confirm(`Resolve incident ${button.dataset.id}?`)) return;
                try {
                    setBusyState(true, 'Resolving incident...');
                    await resolveIncident(button.dataset.id);
                } catch (err) {
                    setStatus(err.message, 'error');
                } finally {
                    setBusyState(false);
                }
                return;
            }

            if (button?.dataset.deleteId) {
                openDeleteModal(button.dataset.deleteId);
                return;
            }

            if (button?.dataset.purgeId) {
                try {
                    setBusyState(true, 'Deleting incident permanently...');
                    await deleteIncidentPermanently(button.dataset.purgeId);
                } catch (err) {
                    setStatus(err.message, 'error');
                } finally {
                    setBusyState(false);
                }
                return;
            }

            if (button?.dataset.removePendingAttachment) {
                pendingAttachments = pendingAttachments.filter((attachment) => attachment.id !== button.dataset.removePendingAttachment);
                renderPendingAttachments();
                return;
            }

            if (button?.dataset.removePendingErrorType) {
                pendingErrorTypes = pendingErrorTypes.filter((value) => value !== button.dataset.removePendingErrorType);
                populateSelects();
                renderPendingErrorTypes();
                return;
            }

            if (button?.dataset.removePendingRecipient) {
                pendingRecipients = pendingRecipients.filter((recipient) => (recipient.id || recipient.email) !== button.dataset.removePendingRecipient);
                populateSelects();
                renderPendingRecipients();
                return;
            }

            if (button?.dataset.removeReference) {
                try {
                    const response = await storageAdapter.removeReferenceItem(button.dataset.removeReference, button.dataset.removeValue);
                    operators = response.references?.operators || operators;
                    suppliers = response.references?.suppliers || suppliers;
                    buyers = response.references?.buyers || buyers;
                    errorTypes = response.references?.errorTypes || errorTypes;
                    recipients = response.references?.recipients || recipients;
                    pendingErrorTypes = pendingErrorTypes.filter((value) => errorTypes.includes(value));
                    pendingRecipients = pendingRecipients.filter((recipient) => recipients.some((item) => (item.id || item.email) === (recipient.id || recipient.email)));
                    refreshAll();
                } catch (err) {
                    setStatus(err.message, 'error');
                }
                return;
            }

            if (button?.dataset.removeRecipientEmail) {
                try {
                    const response = await storageAdapter.removeReferenceItem('recipients', { email: button.dataset.removeRecipientEmail });
                    operators = response.references?.operators || operators;
                    suppliers = response.references?.suppliers || suppliers;
                    buyers = response.references?.buyers || buyers;
                    errorTypes = response.references?.errorTypes || errorTypes;
                    recipients = response.references?.recipients || recipients;
                    pendingRecipients = pendingRecipients.filter((recipient) => recipient.email.toLowerCase() !== button.dataset.removeRecipientEmail.toLowerCase());
                    refreshAll();
                } catch (err) {
                    setStatus(err.message, 'error');
                }
                return;
            }

            if (button?.dataset.viewComment) {
                const inc = incidents.find(i => i.id === button.dataset.viewComment);
                if (!inc) return;
                const label = inc.status === 'Resolved' ? `${inc.id} · Resolved · ${inc.supplier}` : `${inc.id} · ${inc.supplier} · ${inc.batchNumber} · ${inc.partNumber}`;
                openCommentModalForIncident(label, inc);
                return;
            }

            if (button?.dataset.viewDeleteReason) {
                const inc = incidents.find(i => i.id === button.dataset.viewDeleteReason);
                if (!inc) return;
                openCommentModalForIncident(`${inc.id} · Archive reason`, inc);
                return;
            }

            if (button?.dataset.pageAction && button?.dataset.pageTarget) {
                const state = paginationState[button.dataset.pageTarget];
                if (!state) return;
                state.page += button.dataset.pageAction === 'next' ? 1 : -1;
                if (button.dataset.pageTarget === 'open') renderOpen();
                if (button.dataset.pageTarget === 'resolved') renderResolved();
                if (button.dataset.pageTarget === 'deleted') renderDeleted();
                return;
            }

            if (button?.id === 'closeCommentModalBtn' || backdrop?.id === 'commentModal') {
                closeCommentModalForIncident();
                return;
            }

            if (button?.id === 'closeDeleteModalBtn' || button?.id === 'cancelDeleteBtn' || backdrop?.id === 'deleteModal') {
                closeDeleteModal();
                return;
            }

            if (button?.id === 'confirmDeleteBtn') {
                await archiveIncident();
            }
        });

        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape') return;
            closeCommentModalForIncident();
            closeDeleteModal();
        });
        document.addEventListener('change', (e) => {
            const target = e.target;
            if (target.matches('[data-pagination-size]')) {
                const key = target.dataset.paginationSize;
                paginationState[key].pageSize = parseInt(target.value, 10);
                resetPage(key);
                if (key === 'open') renderOpen();
                if (key === 'resolved') renderResolved();
                if (key === 'deleted') renderDeleted();
            }
        });
        document.getElementById('searchDeleted')?.addEventListener('input', ()=>{ resetPage('deleted'); renderDeleted(); });
        document.getElementById('filterSupplierDeleted')?.addEventListener('change', ()=>{ resetPage('deleted'); renderDeleted(); });
        document.getElementById('filterBuyerDeleted')?.addEventListener('change', ()=>{ resetPage('deleted'); renderDeleted(); });
        document.getElementById('filterErrorDeleted')?.addEventListener('change', ()=>{ resetPage('deleted'); renderDeleted(); });
        document.getElementById('clearDeletedFilters')?.addEventListener('click', ()=>{ document.getElementById('searchDeleted').value=''; document.getElementById('filterSupplierDeleted').value=''; document.getElementById('filterBuyerDeleted').value=''; document.getElementById('filterErrorDeleted').value=''; resetPage('deleted'); renderDeleted(); });
        document.getElementById('exportFilteredCsvBtn').addEventListener('click',()=>{
            const list = lastResolvedFiltered; let csv="ID,Opened,Resolved,Duration(h),Supplier,Buyer,Error,Batch,Part,Qty,Operator,Comment,Reference Notes\n";
            list.forEach(i=>{ const d=(new Date(i.resolvedAt)-new Date(i.createdAt))/(1000*60*60); csv+=`"${i.id}","${new Date(i.createdAt).toLocaleString()}","${new Date(i.resolvedAt).toLocaleString()}",${d.toFixed(1)},"${i.supplier}","${i.buyer}","${i.errorType}","${i.batchNumber}","${i.partNumber}",${i.quantity},"${i.operator}","${(i.comment||'').replaceAll('"','""')}","${(i.referenceNotes||'').replaceAll('"','""')}"\n`; });
            const blob=new Blob([csv],{type:'text/csv'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='resolved_filtered.csv'; a.click();
        });
        setInterval(()=>{ renderOpen(); }, 60000);
        // init
        refreshAll();
        loadAppData(true);
    })();
