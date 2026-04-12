// ===== Inbox Domain Finder =====
// Manages inbox placement tests: create, run, poll, view results.
// Depends on: app.js (api, showToast, escapeHtml), user.js (smtpConfigs, loadSmtpConfigs, formatDate)

let inboxFinderTests = [];

// Toggle between manual input and list selection for Inbox Finder RECIPIENTS
function toggleInboxRecipientInput() {
    const source = document.getElementById('inboxTestRecipientSource').value;
    const manualGroup = document.getElementById('inboxManualRecipientsGroup');
    const listGroup = document.getElementById('inboxRecipientListGroup');
    const listPreviewGroup = document.getElementById('inboxListRecipientsGroup');

    if (source === 'list') {
        if (manualGroup) manualGroup.style.display = 'none';
        if (listGroup) listGroup.style.display = 'block';
        if (listPreviewGroup) listPreviewGroup.style.display = 'flex';
        // Populate recipient lists if not already done
        populateInboxRecipientLists();
    } else {
        if (manualGroup) manualGroup.style.display = 'flex';
        if (listGroup) listGroup.style.display = 'none';
        if (listPreviewGroup) listPreviewGroup.style.display = 'none';
    }
    updateInboxCombinationsPreview();
}

// Store loaded recipient lists for preview
let inboxRecipientLists = [];

// Populate recipient lists dropdown for Inbox Finder
async function populateInboxRecipientLists() {
    const select = document.getElementById('inboxTestRecipientList');
    if (!select) return;

    try {
        const data = await api('/user/settings/recipients');
        inboxRecipientLists = data.lists || [];

        select.innerHTML = '<option value="">-- Select Recipient List --</option>' +
            inboxRecipientLists.map(l => {
                const recipients = l.recipients || [];
                const count = Array.isArray(recipients) ? recipients.length : 0;
                return `<option value="${l.id}" data-count="${count}">${escapeHtml(l.name)} (${count} recipients)</option>`;
            }).join('');
    } catch (error) {
        console.error('Failed to load recipient lists:', error);
    }
}

// Load recipient emails from selected list and preview them
async function loadRecipientListEmails() {
    const listId = document.getElementById('inboxTestRecipientList')?.value;
    const previewTextarea = document.getElementById('inboxListRecipientsPreview');

    if (!previewTextarea) return;

    if (!listId) {
        previewTextarea.value = '';
        updateInboxCombinationsPreview();
        return;
    }

    const selectedList = inboxRecipientLists.find(l => l.id == listId);
    if (!selectedList) {
        previewTextarea.value = '';
        updateInboxCombinationsPreview();
        return;
    }

    const recipients = selectedList.recipients || [];
    // Extract full email addresses (not just usernames)
    const emails = recipients.map(item => {
        if (typeof item === 'string') return item;
        return item.email || item.value || '';
    }).filter(e => e && e.includes('@'));

    previewTextarea.value = emails.join('\n');
    updateInboxCombinationsPreview();
}

// Update combinations preview for Inbox Finder
// Shows: senders x recipients = total tests
function updateInboxCombinationsPreview() {
    // Count sender usernames
    const usernamesInput = document.getElementById('inboxTestUsernames');
    const senderUsernames = usernamesInput?.value.split('\n').filter(u => u.trim()).length || 0;

    // Count sender domains
    const domainsInput = document.getElementById('inboxTestDomains');
    const senderDomains = domainsInput?.value.split('\n').filter(d => d.trim()).length || 0;

    // Calculate sender combinations
    const senderCombinations = senderUsernames * senderDomains;

    // Update sender combinations preview
    const senderPreview = document.getElementById('senderCombinationsPreview');
    if (senderPreview) {
        senderPreview.textContent = `${senderCombinations} sender combination${senderCombinations !== 1 ? 's' : ''}`;
    }

    // Count recipients based on source
    const source = document.getElementById('inboxTestRecipientSource')?.value || 'manual';
    let recipientCount = 0;

    if (source === 'list') {
        // Count from the list preview textarea
        const previewTextarea = document.getElementById('inboxListRecipientsPreview');
        recipientCount = previewTextarea?.value.split('\n').filter(e => e.trim()).length || 0;
    } else {
        // Count from manual entry
        const recipientsInput = document.getElementById('inboxTestRecipients');
        recipientCount = recipientsInput?.value.split('\n').filter(e => e.trim()).length || 0;
    }

    // Total tests = senders x recipients
    const totalTests = senderCombinations * recipientCount;

    const preview = document.getElementById('combinationsPreview');
    if (preview) {
        preview.textContent = `${totalTests} tests will be sent (${senderCombinations} senders × ${recipientCount} recipients)`;
    }
}

async function loadInboxFinder() {
    await loadSmtpConfigs(); // Ensure SMTPs are loaded
    await loadInboxFinderTests();
    setupInboxFinderForm();
}

function setupInboxFinderForm() {
    // Populate SMTP dropdown
    const smtpSelect = document.getElementById('inboxTestSmtp');
    smtpSelect.innerHTML = '<option value="">Select SMTP...</option>' +
        smtpConfigs.map(s => `<option value="${s.id}">${escapeHtml(s.name)} (${escapeHtml(s.host)})</option>`).join('');

    // Set initial state for recipient source
    const sourceSelect = document.getElementById('inboxTestRecipientSource');
    if (sourceSelect) {
        sourceSelect.value = 'manual';
        toggleInboxRecipientInput();
    }

    // Update combinations preview on input
    const usernamesInput = document.getElementById('inboxTestUsernames');
    const domainsInput = document.getElementById('inboxTestDomains');
    const recipientListSelect = document.getElementById('inboxTestRecipientList');

    if (usernamesInput) {
        usernamesInput.addEventListener('input', updateInboxCombinationsPreview);
    }
    if (domainsInput) {
        domainsInput.addEventListener('input', updateInboxCombinationsPreview);
    }
    if (recipientListSelect) {
        recipientListSelect.addEventListener('change', updateInboxCombinationsPreview);
    }

    // Form submit
    document.getElementById('inboxFinderForm').onsubmit = async (e) => {
        e.preventDefault();
        await startInboxFinderTest();
    };
}

async function loadInboxFinderTests() {
    try {
        const data = await api('/inbox-finder/tests');
        inboxFinderTests = data.tests || [];

        // Calculate stats
        const totalSent = inboxFinderTests.reduce((sum, t) => sum + (t.sent_count || 0), 0);
        const totalFailed = inboxFinderTests.reduce((sum, t) => sum + (t.failed_count || 0), 0);

        document.getElementById('inboxFinderTotalTests').textContent = inboxFinderTests.length;
        document.getElementById('inboxFinderTotalSent').textContent = totalSent;
        document.getElementById('inboxFinderTotalFailed').textContent = totalFailed;

        renderInboxFinderTests();
    } catch (error) {
        showToast('Failed to load tests: ' + error.message, 'error');
    }
}

function renderInboxFinderTests() {
    const tbody = document.getElementById('inboxFinderTestsBody');

    if (inboxFinderTests.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted">No tests yet. Create your first test above!</td></tr>';
        return;
    }

    tbody.innerHTML = inboxFinderTests.map(t => {
        const statusBadge = {
            'pending': '<span class="badge badge-default">Pending</span>',
            'running': '<span class="badge badge-warning">Running</span>',
            'completed': '<span class="badge badge-success">Completed</span>',
            'cancelled': '<span class="badge badge-danger">Cancelled</span>'
        }[t.status] || '<span class="badge badge-default">Unknown</span>';

        return `
            <tr>
                <td><strong>${escapeHtml(t.name || 'Unnamed Test')}</strong></td>
                <td>${escapeHtml(t.smtp_name || 'Unknown')}</td>
                <td>${t.total_combinations}</td>
                <td><span class="text-success">${t.sent_count || 0}</span></td>
                <td><span class="text-danger">${t.failed_count || 0}</span></td>
                <td>${statusBadge}</td>
                <td>${formatDate(t.created_at)}</td>
                <td>
                    <div class="actions-row">
                        <button class="btn btn-secondary btn-sm" onclick="viewInboxFinderResults(${t.id})" title="View Results">
                            👁️
                        </button>
                        ${t.status === 'running' ?
                            `<button class="btn btn-warning btn-sm" onclick="cancelInboxFinderTest(${t.id})" title="Cancel">✗</button>` :
                            `<button class="btn btn-danger btn-sm" onclick="deleteInboxFinderTest(${t.id})" title="Delete">🗑️</button>`
                        }
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

async function startInboxFinderTest() {
    const smtpId = document.getElementById('inboxTestSmtp').value;
    const name = document.getElementById('inboxTestName').value.trim();
    const recipientSource = document.getElementById('inboxTestRecipientSource')?.value || 'manual';

    if (!smtpId) {
        showToast('Please select an SMTP server', 'error');
        return;
    }

    // Get SENDER usernames (always from manual entry)
    const usernamesText = document.getElementById('inboxTestUsernames').value;
    const usernames = usernamesText.split('\n').map(u => u.trim()).filter(u => u);

    // Get SENDER domains (always from manual entry)
    const domainsText = document.getElementById('inboxTestDomains').value;
    const domains = domainsText.split('\n').map(d => d.trim()).filter(d => d);

    // Get RECIPIENTS based on source
    let recipients = [];

    if (recipientSource === 'list') {
        // Get recipients from selected list
        const listId = document.getElementById('inboxTestRecipientList').value;
        if (!listId) {
            showToast('Please select a recipient list', 'error');
            return;
        }

        try {
            const data = await api('/user/settings/recipients');
            const lists = data.lists || [];
            const selectedList = lists.find(l => l.id == listId);

            if (!selectedList) {
                showToast('Selected list not found', 'error');
                return;
            }

            const listRecipients = selectedList.recipients || [];
            // Extract full email addresses
            recipients = listRecipients.map(item => {
                if (typeof item === 'string') return item;
                return item.email || item.value || '';
            }).filter(e => e && e.includes('@'));
        } catch (error) {
            showToast('Failed to load recipient list: ' + error.message, 'error');
            return;
        }
    } else {
        // Manual entry of recipient emails
        const recipientsText = document.getElementById('inboxTestRecipients').value;
        recipients = recipientsText.split('\n').map(e => e.trim()).filter(e => e && e.includes('@'));
    }

    // Validation
    if (usernames.length === 0) {
        showToast('Please enter at least one sender username', 'error');
        return;
    }

    if (domains.length === 0) {
        showToast('Please enter at least one sender domain', 'error');
        return;
    }

    if (recipients.length === 0) {
        showToast('Please enter at least one recipient email address', 'error');
        return;
    }

    const senderCombinations = usernames.length * domains.length;
    const totalTests = senderCombinations * recipients.length;

    if (totalTests > 1000) {
        showToast(`Maximum 1000 tests allowed (you have ${totalTests}). Reduce senders or recipients.`, 'error');
        return;
    }

    try {
        showToast(`Starting test: ${senderCombinations} senders × ${recipients.length} recipients = ${totalTests} emails...`, 'info');

        await api('/inbox-finder/tests', {
            method: 'POST',
            body: JSON.stringify({
                smtp_config_id: parseInt(smtpId),
                name: name || undefined,
                usernames,
                domains,
                recipients
            })
        });

        showToast('Test started! Emails are being sent...', 'success');

        // Clear form
        document.getElementById('inboxFinderForm').reset();
        document.getElementById('combinationsPreview').textContent = '0 tests will be sent (0 senders × 0 recipients)';
        document.getElementById('senderCombinationsPreview').textContent = '0 sender combinations';

        // Reset source to manual
        const sourceSelect = document.getElementById('inboxTestRecipientSource');
        if (sourceSelect) {
            sourceSelect.value = 'manual';
            toggleInboxRecipientInput();
        }

        // Reload tests
        loadInboxFinderTests();

        // Start polling for updates
        startInboxFinderPolling();

    } catch (error) {
        showToast('Failed to start test: ' + error.message, 'error');
    }
}

let inboxFinderPollInterval = null;

function startInboxFinderPolling() {
    // Poll every 3 seconds to check for running test updates
    if (inboxFinderPollInterval) {
        clearInterval(inboxFinderPollInterval);
    }

    inboxFinderPollInterval = setInterval(async () => {
        const hasRunning = inboxFinderTests.some(t => t.status === 'running');
        if (!hasRunning) {
            clearInterval(inboxFinderPollInterval);
            inboxFinderPollInterval = null;
            return;
        }

        await loadInboxFinderTests();
    }, 3000);
}

async function viewInboxFinderResults(testId) {
    try {
        const data = await api(`/inbox-finder/tests/${testId}`);
        const test = data.test;
        const results = data.results || [];

        // Update summary
        const sentCount = results.filter(r => r.status === 'sent').length;
        const failedCount = results.filter(r => r.status === 'failed').length;
        const pendingCount = results.filter(r => r.status === 'pending').length;

        document.getElementById('inboxFinderResultsSummary').innerHTML = `
            <div style="display: flex; gap: 2rem; justify-content: center;">
                <div style="text-align: center;">
                    <div style="font-size: 1.5rem; font-weight: 600; color: var(--accent-success);">${sentCount}</div>
                    <div style="font-size: 0.85rem; color: var(--text-secondary);">Sent</div>
                </div>
                <div style="text-align: center;">
                    <div style="font-size: 1.5rem; font-weight: 600; color: var(--accent-danger);">${failedCount}</div>
                    <div style="font-size: 0.85rem; color: var(--text-secondary);">Failed</div>
                </div>
                <div style="text-align: center;">
                    <div style="font-size: 1.5rem; font-weight: 600; color: var(--text-muted);">${pendingCount}</div>
                    <div style="font-size: 0.85rem; color: var(--text-secondary);">Pending</div>
                </div>
            </div>
            <div style="text-align: center; margin-top: 1rem; font-size: 0.9rem; color: var(--text-secondary);">
                <strong>Test:</strong> ${escapeHtml(test.name || 'Unnamed')} |
                <strong>SMTP:</strong> ${escapeHtml(test.smtp_name || 'Unknown')}
            </div>
        `;

        // Update results table
        const tbody = document.getElementById('inboxFinderResultsBody');
        tbody.innerHTML = results.map(r => {
            const statusBadge = r.status === 'sent'
                ? '<span class="badge badge-success">✓ Sent</span>'
                : r.status === 'failed'
                    ? '<span class="badge badge-danger">✗ Failed</span>'
                    : '<span class="badge badge-default">Pending</span>';

            return `
                <tr>
                    <td><strong>${escapeHtml(r.email)}</strong></td>
                    <td>${statusBadge}</td>
                    <td style="max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-secondary);">
                        ${r.error_message ? escapeHtml(r.error_message) : '-'}
                    </td>
                </tr>
            `;
        }).join('');

        document.getElementById('inboxFinderResultsModal').classList.add('active');

    } catch (error) {
        showToast('Failed to load results: ' + error.message, 'error');
    }
}

async function cancelInboxFinderTest(testId) {
    if (!confirm('Are you sure you want to cancel this test?')) return;

    try {
        await api(`/inbox-finder/tests/${testId}/cancel`, { method: 'POST' });
        showToast('Test cancelled', 'success');
        loadInboxFinderTests();
    } catch (error) {
        showToast('Failed to cancel test: ' + error.message, 'error');
    }
}

async function deleteInboxFinderTest(testId) {
    if (!confirm('Are you sure you want to delete this test and all results?')) return;

    try {
        await api(`/inbox-finder/tests/${testId}`, { method: 'DELETE' });
        showToast('Test deleted', 'success');
        loadInboxFinderTests();
    } catch (error) {
        showToast('Failed to delete test: ' + error.message, 'error');
    }
}
