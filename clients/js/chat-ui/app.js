/**
 * Chat demo UI — browser client for clients/js/chat-demo.js HTTP API.
 * Sidebar panels: session (Redis), semantic profile (long-term), assemble context.
 */
const $ = (id) => document.getElementById(id);

const state = {
  conversationId: crypto.randomUUID(),
};

function init() {
  $('conv-id').value = state.conversationId;
  loadHealth();
  refreshState();
  $('chat-form').addEventListener('submit', onSend);
  $('btn-new').addEventListener('click', newChat);
  $('btn-end').addEventListener('click', endSession);
  $('agent-id').addEventListener('change', refreshState);
  $('user-id').addEventListener('change', refreshState);
}

async function loadHealth() {
  try {
    const r = await fetch('/api/health');
    const h = await r.json();
    $('health').textContent = `memory-api=${h.memoryApi} llm=${h.llm} ${h.integration ?? ''}`;
  } catch {
    $('health').textContent = 'API offline — run npm run chat';
  }
}

async function refreshState() {
  const p = params();
  const q = new URLSearchParams(p);
  const r = await fetch(`/api/state?${q}`);
  const data = await r.json();
  if (!r.ok) {
    $('profile').textContent = data.error ? `Error: ${data.error}` : 'Failed to load state';
    return null;
  }
  $('turn-count').textContent = String(data.session?.turnCount ?? 0);
  $('summary').textContent = data.session?.summary || '—';
  $('profile').textContent = semanticProfileText(data);
  return data;
}

function params() {
  return {
    agentId: $('agent-id').value.trim(),
    userId: $('user-id').value.trim(),
    conversationId: state.conversationId,
  };
}

function addMessage(role, text, meta) {
  const el = document.createElement('div');
  el.className = `msg ${role}`;
  el.textContent = text;
  if (meta) {
    const m = document.createElement('div');
    m.className = 'meta';
    m.textContent = meta;
    el.appendChild(m);
  }
  $('messages').appendChild(el);
  $('messages').scrollTop = $('messages').scrollHeight;
}

function semanticProfileText(data) {
  if (data.semanticProfile) return data.semanticProfile;
  if (data.assemble?.semanticProfile) return data.assemble.semanticProfile;
  return '—';
}

function renderSide(data) {
  $('turn-count').textContent = String(data.session?.turnCount ?? 0);
  $('summary').textContent = data.session?.summary || '—';
  $('profile').textContent = semanticProfileText(data);
  $('context').textContent = data.assemble?.contextBlock || '(empty)';

  const memUl = $('memories');
  memUl.innerHTML = '';
  for (const m of data.assemble?.memories ?? []) {
    const li = document.createElement('li');
    li.innerHTML = `<span class="type">[${m.type}] ${m.score?.toFixed?.(2) ?? ''}</span> ${escapeHtml(m.content.slice(0, 120))}${m.content.length > 120 ? '…' : ''}`;
    memUl.appendChild(li);
  }
  if (!memUl.children.length) memUl.innerHTML = '<li class="muted">No memories matched</li>';
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function onSend(e) {
  e.preventDefault();
  const input = $('input');
  const message = input.value.trim();
  if (!message) return;

  const btn = $('chat-form').querySelector('button');
  btn.disabled = true;
  addMessage('user', message);

  try {
    const r = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, ...params() }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || r.statusText);

    const jobs = data.jobs ?? {};
    const meta = `${jobs.lastPromptTokens ?? 0} prompt tokens${jobs.summarizeScheduled ? ' · summarize queued' : ''} · assemble ${data.assemble?.latencyMs ?? 0}ms`;
    addMessage('assistant', data.reply, meta);
    renderSide(data);
    setTimeout(refreshState, 2000);
    setTimeout(refreshState, 5000);
  } catch (err) {
    addMessage('assistant', `Error: ${err.message}`);
  } finally {
    input.value = '';
    btn.disabled = false;
    input.focus();
  }
}

function newChat() {
  state.conversationId = crypto.randomUUID();
  $('conv-id').value = state.conversationId;
  $('messages').innerHTML = '';
  $('turn-count').textContent = '0';
  $('summary').textContent = '—';
  $('context').textContent = '—';
  $('memories').innerHTML = '';
  refreshState();
}

async function endSession() {
  if (!confirm('End session? Consolidates semantic profile + writes episodic memory.')) return;
  const p = params();
  $('profile').textContent = 'Consolidating…';
  try {
    const r = await fetch('/api/session/end', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...p, clearSession: true }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error);

    addMessage('assistant', data.message || 'Session end job queued.');

    if (data.semanticProfile) {
      $('profile').textContent = data.semanticProfile;
    } else {
      await pollSemanticProfile(p);
    }

    newChat();
  } catch (err) {
    alert(err.message);
    await refreshState();
  }
}

/** Poll until session_end worker writes the semantic profile (or timeout). */
async function pollSemanticProfile(p, { attempts = 15, intervalMs = 2000 } = {}) {
  for (let i = 0; i < attempts; i++) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    const q = new URLSearchParams(p);
    const r = await fetch(`/api/state?${q}`);
    const data = await r.json();
    if (!r.ok) continue;
    const text = semanticProfileText(data);
    if (text && text !== '—') {
      $('profile').textContent = text;
      return text;
    }
  }
  $('profile').textContent = '— (consolidation still running or empty — check worker logs)';
  return null;
}

init();
