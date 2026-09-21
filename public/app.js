import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore, collection, doc, onSnapshot, addDoc, setDoc, updateDoc, deleteDoc,
  getDoc, writeBatch, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const fb = initializeApp({
  apiKey: "AIzaSyCTFqIkSB7SLUePFYadm8wXBHos_OZiaHg",
  authDomain: "lvaep-tutor-log.firebaseapp.com",
  projectId: "lvaep-tutor-log",
  storageBucket: "lvaep-tutor-log.firebasestorage.app",
  messagingSenderId: "436837582068",
  appId: "1:436837582068:web:1b0bfac56a48f967608aa1",
});
const db = getFirestore(fb);

// Staff passcode: a light gate so tutors land on their own view. Change it here.
const STAFF_CODE = "lvaep2026";

// ---- Goals, exactly as on the paper form ----
const GOALS = [
  { group: "A. Economic", items: [
    ["A1", "*Enter Employment"], ["A2", "*Retain Employment"], ["A3", "Leave public assistance"]] },
  { group: "B. Educational", items: [
    ["B1", "Achieve work-based project learner goal"], ["B2", "*Enter Occupational Skills Training Program"],
    ["B3", "*Enter Postsecondary Education"], ["B4", "*Obtain High School Diploma"]] },
  { group: "C. Family", items: [
    ["C1", "Help more frequently with school"], ["C2", "Increase contact with child(ren)'s teachers"],
    ["C3", "More involvement in child(ren)'s school activities"], ["C4", "Purchase books or magazines"],
    ["C5", "Read to child(ren)"], ["C6", "Visit the library (with/for child(ren))"]] },
  { group: "D. Societal/Community", items: [
    ["D1", "*Obtain citizenship"], ["D2", "Achieve civics skills"],
    ["D3", "Increase involvement in community activities"], ["D4", "Vote or register to vote"]] },
];
const GOAL_LABEL = Object.fromEntries(GOALS.flatMap((g) => g.items));

const STATUS = {
  held: { label: "Session held", code: "" },
  SA: { label: "Student absent", code: "SA" },
  TA: { label: "Tutor absent", code: "TA" },
  H: { label: "Holiday / closed", code: "H" },
};

// ---- State ----
const store = {
  get(k) { try { return localStorage.getItem("lvaep." + k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem("lvaep." + k, v); } catch { /* storage unavailable */ } },
};
const S = {
  tutors: new Map(), students: new Map(), pairs: new Map(), sessions: new Map(),
  loaded: { tutors: false, students: false, pairs: false, sessions: false },
  role: store.get("role") || "tutor",
  tutorId: store.get("tutorId") || "",
  staffOk: sessionGet("staffOk") === "1",
  staffTab: store.get("staffTab") || "report",
  month: todayISO().slice(0, 7),
  formPairId: "",
  fy: fyStart(todayISO()),
  editId: "",
  draft: null,
};

// ---- Utilities ----
function sessionGet(k) { try { return sessionStorage.getItem("lvaep." + k); } catch { return null; } }
function sessionSet(k, v) { try { sessionStorage.setItem("lvaep." + k, v); } catch { /* ignore */ } }

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function fyStart(iso) { const [y, m] = iso.split("-").map(Number); return m >= 7 ? y : y - 1; }
function fyMonths(y) {
  const out = [];
  for (let i = 0; i < 12; i++) { const m = ((6 + i) % 12) + 1; const yr = i < 6 ? y : y + 1; out.push(`${yr}-${String(m).padStart(2, "0")}`); }
  return out;
}
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_FULL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
function monthLabel(ym) { const [y, m] = ym.split("-").map(Number); return `${MONTH_FULL[m - 1]} ${y}`; }
function shortDate(iso) { const [, m, d] = iso.split("-").map(Number); return `${MON[m - 1]} ${d}`; }
function weekday(iso) { const [y, m, d] = iso.split("-").map(Number); return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(y, m - 1, d).getDay()]; }
function daysIn(ym) { const [y, m] = ym.split("-").map(Number); return new Date(y, m, 0).getDate(); }
function fmtH(n) { return (Math.round(n * 100) / 100).toString(); }
function byName(a, b) { return (a.name || "").localeCompare(b.name || ""); }
function addDays(iso, n) { const [y, m, d] = iso.split("-").map(Number); const t = new Date(y, m - 1, d + n); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`; }

function tutorName(id) { return S.tutors.get(id)?.name || "Unknown tutor"; }
function studentName(id) { return S.students.get(id)?.name || "Unknown student"; }
function pairLabel(p) { return `${tutorName(p.tutorId)} → ${studentName(p.studentId)}`; }
function pairsForTutor(tid) { return [...S.pairs.values()].filter((p) => p.tutorId === tid).sort((a, b) => studentName(a.studentId).localeCompare(studentName(b.studentId))); }
function sessionsFor(pred) { return [...S.sessions.values()].filter(pred).sort((a, b) => b.date.localeCompare(a.date)); }

let toastTimer;
function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
}
async function safe(fn, okMsg) {
  try { await fn(); if (okMsg) toast(okMsg); return true; }
  catch (e) { console.error(e); toast("Couldn't save — check your connection and try again."); return false; }
}

// Summaries for one pair within a month
function monthStats(pairId, ym) {
  const list = sessionsFor((s) => s.pairId === pairId && s.date.startsWith(ym));
  const r = { list, held: 0, hours: 0, SA: 0, TA: 0, H: 0, last: "" };
  for (const s of list) {
    if (s.status === "held") { r.held++; r.hours += Number(s.hours) || 0; } else r[s.status] = (r[s.status] || 0) + 1;
  }
  const all = sessionsFor((s) => s.pairId === pairId && s.status === "held");
  r.last = all[0]?.date || "";
  return r;
}
function goalsInMonth(p, ym) {
  const out = Object.entries(p.goals || {}).filter(([, d]) => d && d.startsWith(ym)).map(([k]) => GOAL_LABEL[k] || k);
  if (p.otherGoal && p.otherGoalDate?.startsWith(ym)) out.push(p.otherGoal);
  return out;
}

// ---- Render root ----
const app = document.getElementById("app");
function render() {
  document.querySelectorAll(".role-switch button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.role === S.role)));
  if (!Object.values(S.loaded).every(Boolean)) return;
  app.innerHTML = S.role === "tutor" ? tutorView() : staffView();
  if (S.role === "tutor") bindTutor(); else bindStaff();
}
document.querySelectorAll(".role-switch button").forEach((b) => b.addEventListener("click", () => {
  S.role = b.dataset.role; store.set("role", S.role); S.editId = ""; S.draft = null; render();
}));

// ================= TUTOR =================
function tutorView() {
  const tutors = [...S.tutors.values()].sort(byName);
  const me = S.tutors.get(S.tutorId);
  if (!me) {
    return `
      <section class="stack">
        <div><div class="eyebrow">Welcome</div><h1>Who's tutoring today?</h1>
        <p class="muted">Pick your name to log sessions. This device will remember you.</p></div>
        <div class="picker">
          ${tutors.map((t) => `<button type="button" data-pick="${esc(t.id)}">${esc(t.name)}<span>${pairsForTutor(t.id).length} student${pairsForTutor(t.id).length === 1 ? "" : "s"}</span></button>`).join("")
            || `<p class="empty">No tutors yet. Staff can add tutors under Staff → People.</p>`}
        </div>
      </section>`;
  }
  const pairs = pairsForTutor(me.id);
  const active = pairs.filter((p) => !p.stopped);
  const ym = todayISO().slice(0, 7);
  const monthHours = pairs.reduce((a, p) => a + monthStats(p.id, ym).hours, 0);
  const editing = S.editId ? S.sessions.get(S.editId) : null;
  const d = S.draft || (editing
    ? { pairId: editing.pairId, date: editing.date, hours: editing.hours, status: editing.status, note: editing.note || "" }
    : { pairId: active[0]?.id || "", date: todayISO(), hours: 1.5, status: "held", note: "" });
  const recent = sessionsFor((s) => s.tutorId === me.id && s.date >= addDays(todayISO(), -45));

  return `
    <section class="hello">
      <div><div class="eyebrow">${esc(monthLabel(ym))}</div>
        <h1>Hi, <em>${esc(me.name.split(" ")[0])}</em></h1>
        <p class="muted" style="margin:4px 0 0">You've logged <b class="num">${fmtH(monthHours)} h</b> this month across ${active.length} active student${active.length === 1 ? "" : "s"}.</p></div>
      <button type="button" class="btn ghost" id="switch-tutor">Not ${esc(me.name.split(" ")[0])}? Switch</button>
    </section>

    <div class="grid-2">
      <section class="card lift">
        <form id="log-form" class="stack" novalidate>
          <div class="row spread"><h2>${editing ? "Edit session" : "Log a session"}</h2>
            ${editing ? `<button type="button" class="btn ghost" id="cancel-edit">Cancel edit</button>` : ""}</div>
          ${active.length || editing ? `
          <label class="field">Student
            <select id="f-pair" required>
              ${pairs.filter((p) => !p.stopped || p.id === d.pairId).map((p) => `<option value="${esc(p.id)}" ${p.id === d.pairId ? "selected" : ""}>${esc(studentName(p.studentId))}${p.site ? " · " + esc(p.site) : ""}</option>`).join("")}
            </select></label>
          <div class="fields">
            <label class="field">Date
              <input type="date" id="f-date" value="${esc(d.date)}" max="${todayISO()}" required></label>
            <div class="field">Hours tutored
              <div class="hours">
                <input type="number" id="f-hours" min="0" max="12" step="0.25" value="${d.status === "held" ? esc(d.hours) : 0}" ${d.status === "held" ? "" : "disabled"} aria-label="Hours tutored">
              </div></div>
            <div class="field full" aria-label="Quick hours">
              <div class="hours">${[0.5, 1, 1.5, 2, 2.5, 3].map((h) => `<button type="button" class="chip-btn" data-h="${h}" aria-pressed="${d.status === "held" && Number(d.hours) === h}" ${d.status === "held" ? "" : "disabled"}>${h} h</button>`).join("")}</div>
            </div>
          </div>
          <div class="field">What happened?
            <div class="seg" role="radiogroup">
              ${Object.entries(STATUS).map(([k, v]) => `<input type="radio" name="f-status" id="st-${k}" value="${k}" ${d.status === k ? "checked" : ""}><label for="st-${k}">${v.label}</label>`).join("")}
            </div></div>
          <label class="field">Notes <span class="muted small" style="font-weight:400">(optional — homework, topics, progress)</span>
            <textarea id="f-note" maxlength="500" placeholder="e.g. Reviewed job application vocabulary; assigned reading ch. 3">${esc(d.note)}</textarea></label>
          <div id="f-warn" class="small" style="color:var(--warn)" hidden></div>
          <div class="row"><button type="submit" class="btn primary big">${editing ? "Save changes" : "Save session"}</button></div>
          ` : `<p class="empty">You have no active students assigned. Contact the office at (973) 566-6200 x216.</p>`}
        </form>
      </section>

      <section class="stack">
        <h2>My students</h2>
        <div class="students">
          ${pairs.map((p) => { const st = monthStats(p.id, ym); return `
            <div class="student ${p.stopped ? "stopped" : ""}">
              <div><div class="name">${esc(studentName(p.studentId))} ${p.stopped ? `<span class="pill bad">Stopped</span>` : ""}</div>
                <div class="meta">${esc([p.site, p.days, p.times].filter(Boolean).join(" · ") || "No schedule set")}</div>
                <div class="meta">Last session: ${st.last ? esc(shortDate(st.last)) : "none yet"}</div></div>
              <div class="hrs"><b>${fmtH(st.hours)}</b><span class="small muted">h this month</span></div>
              <div class="actions">
                ${p.stopped ? "" : `<button type="button" class="btn" data-log="${esc(p.id)}">Log for ${esc(studentName(p.studentId).split(" ")[0])}</button>`}
                <button type="button" class="btn ghost" data-goals="${esc(p.id)}">Goals &amp; status</button>
              </div>
            </div>`; }).join("") || `<p class="empty">No students assigned yet.</p>`}
        </div>
      </section>
    </div>

    <section class="card">
      <div class="row spread"><h2>Recent sessions</h2><span class="small muted">Last 45 days · tap Edit to fix a mistake</span></div>
      ${recent.length ? `<ul class="sessions">${recent.map((s) => `
        <li>
          <div class="d">${esc(weekday(s.date))}<b>${esc(shortDate(s.date))}</b></div>
          <div class="who">${esc(studentName(s.studentId))}<small>${s.status === "held" ? esc(s.note || "Session held") : esc(STATUS[s.status]?.label)}</small></div>
          <div class="h">${s.status === "held" ? fmtH(s.hours) + " h" : `<span class="pill warn">${esc(s.status)}</span>`}</div>
          <div class="row" style="gap:2px"><button type="button" class="btn ghost" data-edit="${esc(s.id)}">Edit</button><button type="button" class="btn ghost danger" data-del="${esc(s.id)}" aria-label="Delete session">Delete</button></div>
        </li>`).join("")}</ul>` : `<p class="empty">No sessions logged in the last 45 days.</p>`}
    </section>`;
}

function readDraft() {
  const status = document.querySelector('input[name="f-status"]:checked')?.value || "held";
  return {
    pairId: document.getElementById("f-pair")?.value || "",
    date: document.getElementById("f-date")?.value || todayISO(),
    hours: Number(document.getElementById("f-hours")?.value || 0),
    status,
    note: document.getElementById("f-note")?.value || "",
  };
}

function checkDuplicate() {
  const warn = document.getElementById("f-warn");
  if (!warn) return;
  const d = readDraft();
  const dup = [...S.sessions.values()].find((s) => s.pairId === d.pairId && s.date === d.date && s.id !== S.editId);
  warn.hidden = !dup;
  if (dup) warn.textContent = `You already logged ${dup.status === "held" ? fmtH(dup.hours) + " h" : STATUS[dup.status].label.toLowerCase()} for this student on ${shortDate(d.date)}. Saving adds a second entry.`;
}

function bindTutor() {
  app.querySelectorAll("[data-pick]").forEach((b) => b.addEventListener("click", () => {
    S.tutorId = b.dataset.pick; store.set("tutorId", S.tutorId); render();
  }));
  document.getElementById("switch-tutor")?.addEventListener("click", () => { S.tutorId = ""; store.set("tutorId", ""); S.draft = null; S.editId = ""; render(); });
  document.getElementById("cancel-edit")?.addEventListener("click", () => { S.editId = ""; S.draft = null; render(); });

  const form = document.getElementById("log-form");
  if (form && document.getElementById("f-pair")) {
    const hours = document.getElementById("f-hours");
    form.querySelectorAll("[data-h]").forEach((b) => b.addEventListener("click", () => {
      hours.value = b.dataset.h;
      form.querySelectorAll("[data-h]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      S.draft = readDraft();
    }));
    form.querySelectorAll('input[name="f-status"]').forEach((r) => r.addEventListener("change", () => {
      const held = r.value === "held";
      hours.disabled = !held;
      form.querySelectorAll("[data-h]").forEach((x) => { x.disabled = !held; });
      if (!held) hours.value = 0; else if (!Number(hours.value)) hours.value = 1.5;
      S.draft = readDraft();
    }));
    form.addEventListener("input", () => { S.draft = readDraft(); checkDuplicate(); });
    checkDuplicate();
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const d = readDraft();
      const p = S.pairs.get(d.pairId);
      if (!p) return toast("Choose a student first.");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date) || d.date > todayISO()) return toast("Pick a date on or before today.");
      if (d.status === "held" && !(d.hours > 0 && d.hours <= 12)) return toast("Enter hours between 0.25 and 12.");
      const body = {
        pairId: p.id, tutorId: p.tutorId, studentId: p.studentId, date: d.date,
        hours: d.status === "held" ? Math.round(d.hours * 4) / 4 : 0, status: d.status, note: d.note.trim().slice(0, 500),
        updatedAt: serverTimestamp(),
      };
      const btn = form.querySelector('button[type="submit"]'); btn.disabled = true;
      const msg = d.status === "held" ? `Saved — ${fmtH(body.hours)} h with ${studentName(p.studentId).split(" ")[0]} on ${shortDate(d.date)}` : `Saved — ${STATUS[d.status].label.toLowerCase()} on ${shortDate(d.date)}`;
      const ok = await safe(() => S.editId
        ? updateDoc(doc(db, "sessions", S.editId), body)
        : addDoc(collection(db, "sessions"), { ...body, createdAt: serverTimestamp() }), msg);
      btn.disabled = false;
      if (ok) { S.editId = ""; S.draft = { ...d, note: "", date: todayISO() }; render(); }
    });
  }

  app.querySelectorAll("[data-log]").forEach((b) => b.addEventListener("click", () => {
    S.editId = ""; S.draft = { ...(S.draft || readDraft()), pairId: b.dataset.log }; render();
    document.getElementById("log-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }));
  app.querySelectorAll("[data-edit]").forEach((b) => b.addEventListener("click", () => {
    S.editId = b.dataset.edit; S.draft = null; render();
    document.getElementById("log-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }));
  app.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", async () => {
    const s = S.sessions.get(b.dataset.del);
    if (!s || !confirm(`Delete the ${shortDate(s.date)} session with ${studentName(s.studentId)}?`)) return;
    if (S.editId === s.id) { S.editId = ""; S.draft = null; }
    await safe(() => deleteDoc(doc(db, "sessions", s.id)), "Session deleted");
  }));
  app.querySelectorAll("[data-goals]").forEach((b) => b.addEventListener("click", () => openGoals(b.dataset.goals)));
}

// ---- Goals & status dialog (achievements + STOPPED) ----
function openGoals(pairId) {
  const p = S.pairs.get(pairId); if (!p) return;
  const dlg = document.getElementById("goals-dialog");
  const goals = p.goals || {};
  dlg.innerHTML = `
    <form method="dialog" id="goals-form">
      <div><div class="eyebrow">Achievements · FY ${S.fy}–${String(S.fy + 1).slice(2)}</div>
        <h2>${esc(studentName(p.studentId))}</h2>
        <p class="small muted" style="margin:4px 0 0">Tick each goal when your student attains it. The date is recorded for the monthly report. * = federally reported outcome.</p></div>
      <div class="stack" style="gap:8px">
        ${GOALS.map((g) => `<div class="goal-group"><h4>${esc(g.group)}</h4>
          ${g.items.map(([k, label]) => `<label class="check"><input type="checkbox" name="g" value="${k}" ${goals[k] ? "checked" : ""}> <span>${esc(label)}</span> ${goals[k] ? `<small>${esc(shortDate(goals[k]))}</small>` : ""}</label>`).join("")}
        </div>`).join("")}
        <label class="field">E. Other goal attained <input type="text" id="g-other" maxlength="140" value="${esc(p.otherGoal || "")}" placeholder="Describe another goal your student reached"></label>
      </div>
      <div class="card" style="padding:14px;background:var(--surface-2);border:0">
        <label class="check" style="font-weight:600"><input type="checkbox" id="g-stopped" ${p.stopped ? "checked" : ""}> My student is no longer being tutored</label>
        <label class="field" id="g-reason-wrap" ${p.stopped ? "" : "hidden"}>Reason (the office is notified on the staff dashboard)
          <input type="text" id="g-reason" maxlength="200" value="${esc(p.stoppedReason || "")}" placeholder="e.g. Moved out of state; new work schedule"></label>
      </div>
      <div class="row" style="justify-content:flex-end">
        <button type="button" class="btn ghost" value="cancel" id="g-cancel">Cancel</button>
        <button type="submit" class="btn primary" id="g-save">Save</button>
      </div>
    </form>`;
  const stopped = dlg.querySelector("#g-stopped");
  stopped.addEventListener("change", () => { dlg.querySelector("#g-reason-wrap").hidden = !stopped.checked; });
  dlg.querySelector("#g-cancel").addEventListener("click", () => dlg.close());
  dlg.querySelector("#goals-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const now = todayISO();
    const next = {};
    dlg.querySelectorAll('input[name="g"]:checked').forEach((c) => { next[c.value] = goals[c.value] || now; });
    const other = dlg.querySelector("#g-other").value.trim();
    const isStopped = stopped.checked;
    const reason = dlg.querySelector("#g-reason").value.trim();
    if (isStopped && !reason) { toast("Add a short reason so the office can follow up."); return; }
    const body = {
      goals: next,
      otherGoal: other, otherGoalDate: other ? (other === p.otherGoal ? p.otherGoalDate || now : now) : "",
      stopped: isStopped, stoppedReason: isStopped ? reason : "", stoppedDate: isStopped ? (p.stopped ? p.stoppedDate || now : now) : "",
    };
    const ok = await safe(() => setDoc(doc(db, "pairs", p.id), body, { merge: true }), isStopped && !p.stopped ? "Saved — the office has been notified" : "Goals saved");
    if (ok) dlg.close();
  });
  dlg.showModal();
}

// ================= STAFF =================
function staffView() {
  if (!S.staffOk) {
    return `
      <section class="card lift" style="max-width:420px">
        <form id="gate" class="stack">
          <div><div class="eyebrow">Staff only</div><h2>Program reports</h2>
          <p class="small muted" style="margin:4px 0 0">Enter the staff passcode to see monthly reports and manage tutors.</p></div>
          <label class="field">Passcode <input type="password" id="gate-code" autocomplete="off" required></label>
          <button class="btn primary" type="submit">Open reports</button>
          <p class="small muted" style="margin:0">Demo passcode: <span class="mono">lvaep2026</span></p>
        </form>
      </section>`;
  }
  const demo = [...S.tutors.values()].some((t) => t.demo);
  const tabs = [["report", "Monthly report"], ["form", "Student form"], ["people", "Tutors & students"]];
  return `
    ${demo ? `<div class="banner no-print"><span><b>Example data is loaded</b> so you can see how reports look. Remove it before real use.</span><button type="button" class="btn" id="clear-demo">Remove example data</button></div>` : ""}
    <div class="tabs no-print" role="tablist">
      ${tabs.map(([k, l]) => `<button type="button" role="tab" data-tab="${k}" aria-selected="${S.staffTab === k}">${l}</button>`).join("")}
    </div>
    ${S.staffTab === "report" ? reportView() : S.staffTab === "form" ? formView() : peopleView()}`;
}

function monthOptions(sel) {
  const opts = [];
  const cur = todayISO().slice(0, 7);
  let [y, m] = cur.split("-").map(Number);
  for (let i = 0; i < 18; i++) {
    const ym = `${y}-${String(m).padStart(2, "0")}`;
    opts.push(`<option value="${ym}" ${ym === sel ? "selected" : ""}>${monthLabel(ym)}</option>`);
    m--; if (m === 0) { m = 12; y--; }
  }
  return opts.join("");
}

function reportRows(ym) {
  const monthEnd = `${ym}-${String(daysIn(ym)).padStart(2, "0")}`;
  return [...S.pairs.values()]
    .filter((p) => !(p.stopped && p.stoppedDate && p.stoppedDate < `${ym}-01`) || monthStats(p.id, ym).list.length)
    .filter((p) => !p.createdDate || p.createdDate <= monthEnd)
    .map((p) => {
      const st = monthStats(p.id, ym);
      let state = ["good", "Reported"];
      if (p.stopped) state = ["bad", "Stopped"];
      else if (!st.list.length) state = ["warn", "Nothing logged"];
      else if (!st.held) state = ["warn", "No sessions held"];
      return { p, st, state, goals: goalsInMonth(p, ym) };
    })
    .sort((a, b) => tutorName(a.p.tutorId).localeCompare(tutorName(b.p.tutorId)) || studentName(a.p.studentId).localeCompare(studentName(b.p.studentId)));
}

function reportView() {
  const ym = S.month;
  const rows = reportRows(ym);
  const tot = rows.reduce((a, r) => ({ hours: a.hours + r.st.hours, held: a.held + r.st.held, SA: a.SA + r.st.SA, TA: a.TA + r.st.TA, H: a.H + r.st.H }), { hours: 0, held: 0, SA: 0, TA: 0, H: 0 });
  const active = rows.filter((r) => !r.p.stopped);
  const reporting = active.filter((r) => r.st.list.length).length;
  const attention = [
    ...rows.filter((r) => r.p.stopped && r.p.stoppedDate?.startsWith(ym)).map((r) => ({ kind: "bad", tag: "Stopped", text: `${studentName(r.p.studentId)} (tutor ${tutorName(r.p.tutorId)}) — ${r.p.stoppedReason || "no reason given"}` })),
    ...rows.filter((r) => !r.p.stopped && !r.st.list.length).map((r) => ({ kind: "warn", tag: "Missing", text: `${tutorName(r.p.tutorId)} hasn't logged anything for ${studentName(r.p.studentId)} this month` })),
    ...rows.filter((r) => r.st.SA >= 2).map((r) => ({ kind: "warn", tag: "Absences", text: `${studentName(r.p.studentId)} missed ${r.st.SA} sessions` })),
  ];
  const byTutor = new Map();
  for (const r of rows) { const t = byTutor.get(r.p.tutorId) || { hours: 0, held: 0, students: 0 }; t.hours += r.st.hours; t.held += r.st.held; t.students++; byTutor.set(r.p.tutorId, t); }
  const goalsHit = rows.flatMap((r) => r.goals.map((g) => ({ g, s: studentName(r.p.studentId) })));

  return `
    <section class="row spread">
      <div><div class="eyebrow">Monthly attendance &amp; achievement report</div><h1>${esc(monthLabel(ym))}</h1></div>
      <div class="row no-print">
        <select id="month" aria-label="Report month" style="width:auto">${monthOptions(ym)}</select>
        <button type="button" class="btn" id="csv">Download CSV</button>
        <button type="button" class="btn" id="print">Print</button>
      </div>
    </section>

    <section class="kpis">
      <div class="kpi"><span class="eyebrow">Hours tutored</span><b>${fmtH(tot.hours)}</b><small>${tot.held} sessions held</small></div>
      <div class="kpi"><span class="eyebrow">Pairs reporting</span><b>${reporting}<span class="muted" style="font-size:1rem">/${active.length}</span></b><small>active tutor–student pairs</small></div>
      <div class="kpi"><span class="eyebrow">Missed sessions</span><b>${tot.SA + tot.TA}</b><small>${tot.SA} student · ${tot.TA} tutor · ${tot.H} holiday</small></div>
      <div class="kpi"><span class="eyebrow">Goals attained</span><b>${goalsHit.length}</b><small>recorded this month</small></div>
    </section>

    ${attention.length ? `<section class="card"><h3 style="margin-bottom:10px">Needs follow-up</h3><div class="attn">
      ${attention.map((a) => `<div class="attn-item"><span class="pill ${a.kind}">${a.tag}</span><span>${esc(a.text)}</span></div>`).join("")}</div></section>` : ""}

    <section class="stack">
      <div class="table-wrap"><table class="report">
        <thead><tr><th>Tutor</th><th>Student</th><th>Site · schedule</th><th class="n">Sessions</th><th class="n">Hours</th><th class="n">SA</th><th class="n">TA</th><th class="n">H</th><th>Last session</th><th>Status</th></tr></thead>
        <tbody>
          ${rows.map((r) => `<tr class="clickable" data-open-form="${esc(r.p.id)}" title="Open this student's form">
            <td>${esc(tutorName(r.p.tutorId))}</td><td><b>${esc(studentName(r.p.studentId))}</b>${r.goals.length ? `<div class="small" style="color:var(--good)">✓ ${esc(r.goals.join("; "))}</div>` : ""}</td>
            <td class="small muted">${esc([r.p.site, r.p.days, r.p.times].filter(Boolean).join(" · "))}</td>
            <td class="n">${r.st.held}</td><td class="n"><b>${fmtH(r.st.hours)}</b></td><td class="n">${r.st.SA || ""}</td><td class="n">${r.st.TA || ""}</td><td class="n">${r.st.H || ""}</td>
            <td class="mono small">${r.st.last ? esc(shortDate(r.st.last)) : "—"}</td>
            <td><span class="pill ${r.state[0]}">${r.state[1]}</span></td></tr>`).join("") || `<tr><td colspan="10" class="empty">No tutor–student pairs yet. Add them under “Tutors &amp; students”.</td></tr>`}
        </tbody>
        ${rows.length ? `<tfoot><tr><td colspan="3">Total</td><td class="n">${tot.held}</td><td class="n">${fmtH(tot.hours)}</td><td class="n">${tot.SA}</td><td class="n">${tot.TA}</td><td class="n">${tot.H}</td><td colspan="2"></td></tr></tfoot>` : ""}
      </table></div>
      <p class="small muted" style="margin:0">SA = student absent · TA = tutor absent · H = holiday/closed. Click a row to see that student's full-year form.</p>
    </section>

    <section class="grid-2">
      <div class="card"><h3 style="margin-bottom:8px">Hours by tutor</h3>
        <table class="report"><thead><tr><th>Tutor</th><th class="n">Students</th><th class="n">Sessions</th><th class="n">Hours</th></tr></thead><tbody>
        ${[...byTutor.entries()].sort((a, b) => b[1].hours - a[1].hours).map(([id, t]) => `<tr><td>${esc(tutorName(id))}</td><td class="n">${t.students}</td><td class="n">${t.held}</td><td class="n"><b>${fmtH(t.hours)}</b></td></tr>`).join("")}
        </tbody></table></div>
      <div class="card"><h3 style="margin-bottom:8px">Goals attained in ${esc(monthLabel(ym).split(" ")[0])}</h3>
        ${goalsHit.length ? `<ul class="plist">${goalsHit.map((x) => `<li><span>${esc(x.g)}</span><span class="small muted">${esc(x.s)}</span></li>`).join("")}</ul>` : `<p class="empty">No goals recorded this month.</p>`}</div>
    </section>`;
}

function csvCell(v) { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }
function downloadCSV() {
  const ym = S.month;
  const head = ["Month", "Tutor", "Student", "Tutoring site", "Day(s)", "Time(s)", "Sessions held", "Hours", "Student absent", "Tutor absent", "Holiday", "Last session", "Status", "Stopped reason", "Goals attained this month", "Session dates (hours)"];
  const lines = [head.map(csvCell).join(",")];
  for (const r of reportRows(ym)) {
    const detail = [...r.st.list].reverse().map((s) => `${s.date.slice(8)}:${s.status === "held" ? fmtH(s.hours) : s.status}`).join(" ");
    lines.push([monthLabel(ym), tutorName(r.p.tutorId), studentName(r.p.studentId), r.p.site, r.p.days, r.p.times, r.st.held, fmtH(r.st.hours), r.st.SA, r.st.TA, r.st.H, r.st.last, r.state[1], r.p.stoppedReason, r.goals.join("; "), detail].map(csvCell).join(","));
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = `LVAEP-tutoring-report-${ym}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function formView() {
  const pairs = [...S.pairs.values()].sort((a, b) => pairLabel(a).localeCompare(pairLabel(b)));
  if (!S.pairs.has(S.formPairId)) S.formPairId = pairs[0]?.id || "";
  const p = S.pairs.get(S.formPairId);
  const months = fyMonths(S.fy);
  const fyOpts = [S.fy + 1, S.fy, S.fy - 1, S.fy - 2].filter((y) => y <= fyStart(todayISO())).map((y) => `<option value="${y}" ${y === S.fy ? "selected" : ""}>FY ${y}–${y + 1}</option>`).join("");
  if (!p) return `<p class="empty">No tutor–student pairs yet.</p>`;

  const cell = {}; const totals = {};
  for (const s of S.sessions.values()) {
    if (s.pairId !== p.id) continue;
    const ym = s.date.slice(0, 7); if (!months.includes(ym)) continue;
    const day = Number(s.date.slice(8));
    const c = (cell[ym + "-" + day] ||= { h: 0, codes: [] });
    if (s.status === "held") { c.h += Number(s.hours) || 0; totals[ym] = (totals[ym] || 0) + (Number(s.hours) || 0); } else c.codes.push(s.status);
  }
  const fyTotal = Object.values(totals).reduce((a, b) => a + b, 0);
  const goals = p.goals || {};

  return `
    <section class="row spread no-print">
      <div class="row">
        <select id="form-pair" aria-label="Tutor and student" style="width:auto;max-width:100%">${pairs.map((x) => `<option value="${esc(x.id)}" ${x.id === p.id ? "selected" : ""}>${esc(pairLabel(x))}</option>`).join("")}</select>
        <select id="form-fy" aria-label="Fiscal year" style="width:auto">${fyOpts}</select>
      </div>
      <button type="button" class="btn" id="print">Print form</button>
    </section>

    <section class="paper">
      <div class="paper-head">
        <div><div class="org">Literacy Volunteers of America, Essex/Passaic County</div>
          <div style="font-weight:600">Student Monthly Attendance &amp; Achievement Form – FY ${S.fy}–${S.fy + 1}</div>
          <div class="row" style="margin-top:8px;gap:24px"><span>Tutor: <b>${esc(tutorName(p.tutorId))}</b></span><span>Student: <b>${esc(studentName(p.studentId))}</b></span>
          <span>FY total: <b class="num">${fmtH(fyTotal)} h</b></span></div></div>
        <div class="small muted" style="text-align:right">Generated automatically from tutor session logs<br>${esc(new Date().toLocaleDateString(undefined, { dateStyle: "medium" }))}</div>
      </div>
      <div class="paper-body">
        <div style="overflow-x:auto"><table class="grid">
          <thead><tr><th></th>${months.map((ym) => `<th>${MON[Number(ym.slice(5)) - 1]}</th>`).join("")}</tr></thead>
          <tbody>
            ${Array.from({ length: 31 }, (_, i) => i + 1).map((day) => `<tr><td class="day">${day}</td>${months.map((ym) => {
              if (day > daysIn(ym)) return `<td class="x"></td>`;
              const c = cell[ym + "-" + day];
              if (!c) return `<td></td>`;
              if (c.h) return `<td class="has">${fmtH(c.h)}</td>`;
              return `<td class="code">${esc(c.codes.join("/"))}</td>`;
            }).join("")}</tr>`).join("")}
            <tr class="total"><td class="day">Total</td>${months.map((ym) => `<td>${totals[ym] ? fmtH(totals[ym]) : ""}</td>`).join("")}</tr>
          </tbody>
        </table></div>
        <div class="goals">
          <div class="eyebrow" style="margin-bottom:6px">Achievements</div>
          ${GOALS.map((g) => `<h4>${esc(g.group)}</h4>${g.items.map(([k, l]) => `<div class="goal ${goals[k] ? "on" : ""}"><span>${esc(l)}</span><span class="box">${goals[k] ? "✓ " + esc(shortDate(goals[k])) : "☐"}</span></div>`).join("")}`).join("")}
          <h4>E. Other(s)</h4><div class="goal ${p.otherGoal ? "on" : ""}"><span>${esc(p.otherGoal || "—")}</span><span class="box">${p.otherGoal ? "✓ " + esc(shortDate(p.otherGoalDate || todayISO())) : ""}</span></div>
          <h4>Stopped</h4><div class="goal ${p.stopped ? "on" : ""}"><span>${p.stopped ? "Reason: " + esc(p.stoppedReason) : "Student is being tutored"}</span><span class="box">${p.stopped ? "✓ " + esc(shortDate(p.stoppedDate || todayISO())) : "☐"}</span></div>
        </div>
      </div>
      <div class="paper-foot"><span><b>Tutoring site:</b> ${esc(p.site || "—")}</span><span><b>Day(s):</b> ${esc(p.days || "—")}</span><span><b>Time(s):</b> ${esc(p.times || "—")}</span></div>
    </section>`;
}

function peopleView() {
  const tutors = [...S.tutors.values()].sort(byName);
  const students = [...S.students.values()].sort(byName);
  const pairs = [...S.pairs.values()].sort((a, b) => pairLabel(a).localeCompare(pairLabel(b)));
  return `
    <section class="grid-3">
      <div class="card stack">
        <h3>Tutors <span class="muted small">(${tutors.length})</span></h3>
        <form id="add-tutor" class="stack" style="gap:8px">
          <input type="text" id="t-name" placeholder="Full name" maxlength="80" required aria-label="Tutor name">
          <input type="email" id="t-email" placeholder="Email (optional)" maxlength="120" aria-label="Tutor email">
          <button class="btn primary" type="submit">Add tutor</button>
        </form>
        <ul class="plist">${tutors.map((t) => `<li><span>${esc(t.name)}<small>${esc(t.email || "")}</small></span><button type="button" class="btn ghost danger" data-rm-tutor="${esc(t.id)}">Remove</button></li>`).join("")}</ul>
      </div>
      <div class="card stack">
        <h3>Students <span class="muted small">(${students.length})</span></h3>
        <form id="add-student" class="stack" style="gap:8px">
          <input type="text" id="s-name" placeholder="Full name" maxlength="80" required aria-label="Student name">
          <button class="btn primary" type="submit">Add student</button>
        </form>
        <ul class="plist">${students.map((s) => `<li><span>${esc(s.name)}</span><button type="button" class="btn ghost danger" data-rm-student="${esc(s.id)}">Remove</button></li>`).join("")}</ul>
      </div>
      <div class="card stack">
        <h3>Assignments <span class="muted small">(${pairs.length})</span></h3>
        <form id="add-pair" class="stack" style="gap:8px">
          <select id="p-tutor" required aria-label="Tutor"><option value="">Tutor…</option>${tutors.map((t) => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join("")}</select>
          <select id="p-student" required aria-label="Student"><option value="">Student…</option>${students.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join("")}</select>
          <input type="text" id="p-site" placeholder="Tutoring site, e.g. Bloomfield Public Library" maxlength="100" aria-label="Tutoring site">
          <div class="fields" style="gap:8px"><input type="text" id="p-days" placeholder="Day(s), e.g. Tue/Thu" maxlength="60" aria-label="Days"><input type="text" id="p-times" placeholder="Time(s), e.g. 6–7:30 pm" maxlength="60" aria-label="Times"></div>
          <button class="btn primary" type="submit">Assign</button>
        </form>
        <ul class="plist">${pairs.map((p) => `<li><span>${esc(pairLabel(p))} ${p.stopped ? `<span class="pill bad">Stopped</span>` : ""}<small>${esc([p.site, p.days, p.times].filter(Boolean).join(" · "))}</small></span>
          <span class="row" style="gap:0">${p.stopped ? `<button type="button" class="btn ghost" data-resume="${esc(p.id)}">Resume</button>` : ""}<button type="button" class="btn ghost danger" data-rm-pair="${esc(p.id)}">Remove</button></span></li>`).join("")}</ul>
      </div>
    </section>`;
}

function bindStaff() {
  document.getElementById("gate")?.addEventListener("submit", (e) => {
    e.preventDefault();
    if (document.getElementById("gate-code").value.trim() === STAFF_CODE) { S.staffOk = true; sessionSet("staffOk", "1"); render(); }
    else toast("That passcode isn't right.");
  });
  app.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => { S.staffTab = b.dataset.tab; store.set("staffTab", S.staffTab); render(); }));
  document.getElementById("month")?.addEventListener("change", (e) => { S.month = e.target.value; render(); });
  document.getElementById("csv")?.addEventListener("click", downloadCSV);
  document.getElementById("print")?.addEventListener("click", () => window.print());
  app.querySelectorAll("[data-open-form]").forEach((r) => r.addEventListener("click", () => {
    S.formPairId = r.dataset.openForm; S.fy = fyStart(S.month + "-01"); S.staffTab = "form"; render(); window.scrollTo(0, 0);
  }));
  document.getElementById("form-pair")?.addEventListener("change", (e) => { S.formPairId = e.target.value; render(); });
  document.getElementById("form-fy")?.addEventListener("change", (e) => { S.fy = Number(e.target.value); render(); });
  document.getElementById("clear-demo")?.addEventListener("click", clearDemo);

  document.getElementById("add-tutor")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = document.getElementById("t-name").value.trim(); if (!name) return;
    await safe(() => addDoc(collection(db, "tutors"), { name, email: document.getElementById("t-email").value.trim() }), `Added ${name}`);
  });
  document.getElementById("add-student")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = document.getElementById("s-name").value.trim(); if (!name) return;
    await safe(() => addDoc(collection(db, "students"), { name }), `Added ${name}`);
  });
  document.getElementById("add-pair")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const tutorId = document.getElementById("p-tutor").value, studentId = document.getElementById("p-student").value;
    if (!tutorId || !studentId) return toast("Choose both a tutor and a student.");
    if ([...S.pairs.values()].some((p) => p.tutorId === tutorId && p.studentId === studentId)) return toast("That tutor is already assigned to this student.");
    await safe(() => addDoc(collection(db, "pairs"), {
      tutorId, studentId, site: document.getElementById("p-site").value.trim(), days: document.getElementById("p-days").value.trim(),
      times: document.getElementById("p-times").value.trim(), stopped: false, stoppedReason: "", goals: {}, createdDate: todayISO(),
    }), `Assigned ${studentName(studentId)} to ${tutorName(tutorId)}`);
  });
  app.querySelectorAll("[data-rm-tutor]").forEach((b) => b.addEventListener("click", async () => {
    const id = b.dataset.rmTutor;
    if ([...S.pairs.values()].some((p) => p.tutorId === id)) return toast("Remove this tutor's assignments first.");
    if (confirm(`Remove ${tutorName(id)}?`)) await safe(() => deleteDoc(doc(db, "tutors", id)), "Tutor removed");
  }));
  app.querySelectorAll("[data-rm-student]").forEach((b) => b.addEventListener("click", async () => {
    const id = b.dataset.rmStudent;
    if ([...S.pairs.values()].some((p) => p.studentId === id)) return toast("Remove this student's assignments first.");
    if (confirm(`Remove ${studentName(id)}?`)) await safe(() => deleteDoc(doc(db, "students", id)), "Student removed");
  }));
  app.querySelectorAll("[data-rm-pair]").forEach((b) => b.addEventListener("click", async () => {
    const p = S.pairs.get(b.dataset.rmPair);
    const n = [...S.sessions.values()].filter((s) => s.pairId === p.id).length;
    if (!confirm(`Remove ${pairLabel(p)}?${n ? ` Their ${n} logged session(s) will also be deleted. To keep history, mark the student as stopped instead.` : ""}`)) return;
    await safe(async () => {
      const ids = [...S.sessions.values()].filter((s) => s.pairId === p.id).map((s) => s.id);
      for (let i = 0; i < ids.length; i += 400) { const wb = writeBatch(db); ids.slice(i, i + 400).forEach((id) => wb.delete(doc(db, "sessions", id))); await wb.commit(); }
      await deleteDoc(doc(db, "pairs", p.id));
    }, "Assignment removed");
  }));
  app.querySelectorAll("[data-resume]").forEach((b) => b.addEventListener("click", () =>
    safe(() => updateDoc(doc(db, "pairs", b.dataset.resume), { stopped: false, stoppedReason: "", stoppedDate: "" }), "Tutoring resumed")));
}

// ---- Example data (first run only) ----
async function seedIfEmpty() {
  const meta = doc(db, "meta", "seed");
  const m = await getDoc(meta);
  if (m.exists()) return;
  await setDoc(meta, { at: serverTimestamp() });
  const wb = writeBatch(db);
  const T = { dana: "Dana Whitfield", luis: "Luis Ortega", priya: "Priya Raman" };
  const St = { maria: "Maria Santos", jean: "Jean-Baptiste Pierre", ahmed: "Ahmed Hassan", lucia: "Lucía Fernández" };
  for (const [k, name] of Object.entries(T)) wb.set(doc(db, "tutors", "demo-" + k), { name, email: "", demo: true });
  for (const [k, name] of Object.entries(St)) wb.set(doc(db, "students", "demo-" + k), { name, demo: true });
  const P = [
    { id: "demo-p1", tutorId: "demo-dana", studentId: "demo-maria", site: "Bloomfield Public Library", days: "Tue / Thu", times: "6:00–7:30 pm", wd: [2, 4], h: 1.5, goals: { A1: "2026-08-20", C5: "2026-09-10" } },
    { id: "demo-p2", tutorId: "demo-dana", studentId: "demo-ahmed", site: "Montclair Public Library", days: "Sat", times: "10:00–11:30 am", wd: [6], h: 1.5, goals: {} },
    { id: "demo-p3", tutorId: "demo-luis", studentId: "demo-jean", site: "Paterson Free Public Library", days: "Mon / Wed", times: "5:00–6:00 pm", wd: [1, 3], h: 1, goals: { D2: "2026-09-16" } },
    { id: "demo-p4", tutorId: "demo-priya", studentId: "demo-lucia", site: "Bloomfield Public Library", days: "Fri", times: "3:00–5:00 pm", wd: [5], h: 2, goals: {}, stopUntil: "2026-08-31" },
  ];
  const end = todayISO();
  let n = 0;
  for (const p of P) {
    wb.set(doc(db, "pairs", p.id), { tutorId: p.tutorId, studentId: p.studentId, site: p.site, days: p.days, times: p.times, goals: p.goals, stopped: false, stoppedReason: "", createdDate: "2026-07-01", demo: true });
    for (let d = "2026-07-01"; d < end; d = addDays(d, 1)) {
      const [y, m, dd] = d.split("-").map(Number);
      if (!p.wd.includes(new Date(y, m - 1, dd).getDay())) continue;
      if (p.stopUntil && d > p.stopUntil) continue;
      n++;
      let status = "held"; let h = p.h;
      if (d === "2026-07-03" || d === "2026-09-07") status = "H";
      else if (n % 11 === 0) status = "SA";
      else if (n % 17 === 0) status = "TA";
      else if (n % 5 === 0) h = p.h + 0.5;
      wb.set(doc(collection(db, "sessions")), { pairId: p.id, tutorId: p.tutorId, studentId: p.studentId, date: d, hours: status === "held" ? h : 0, status, note: status === "held" && n % 3 === 0 ? "Reading practice and vocabulary review; homework assigned" : "", demo: true, createdAt: serverTimestamp() });
    }
  }
  await wb.commit();
}

async function clearDemo() {
  if (!confirm("Remove all example tutors, students, assignments and sessions?")) return;
  await safe(async () => {
    const refs = [
      ...[...S.sessions.values()].filter((x) => x.demo).map((x) => doc(db, "sessions", x.id)),
      ...[...S.pairs.values()].filter((x) => x.demo).map((x) => doc(db, "pairs", x.id)),
      ...[...S.tutors.values()].filter((x) => x.demo).map((x) => doc(db, "tutors", x.id)),
      ...[...S.students.values()].filter((x) => x.demo).map((x) => doc(db, "students", x.id)),
    ];
    for (let i = 0; i < refs.length; i += 400) { const wb = writeBatch(db); refs.slice(i, i + 400).forEach((r) => wb.delete(r)); await wb.commit(); }
  }, "Example data removed");
  if (S.tutorId.startsWith("demo-")) { S.tutorId = ""; store.set("tutorId", ""); }
}

// ---- Live data ----
function listen(name) {
  onSnapshot(collection(db, name), (snap) => {
    const m = new Map();
    snap.forEach((d) => m.set(d.id, { id: d.id, ...d.data() }));
    S[name] = m; S.loaded[name] = true;
    refresh();
  }, (err) => {
    console.error(err);
    app.innerHTML = `<p class="card">Couldn't reach the program database. Check your connection and reload the page.</p>`;
  });
}
// Live updates from other devices: never re-render under someone's cursor or an open dialog.
let pending = false;
function isTyping() { const a = document.activeElement; return !!a && app.contains(a) && ["INPUT", "TEXTAREA", "SELECT"].includes(a.tagName); }
function refresh() {
  if (document.getElementById("goals-dialog").open || isTyping()) { pending = true; return; }
  pending = false;
  if (S.role === "tutor" && document.getElementById("f-pair")) S.draft = readDraft();
  render();
}
app.addEventListener("focusout", () => setTimeout(() => { if (pending) refresh(); }, 0));
document.getElementById("goals-dialog").addEventListener("close", () => { pending = false; refresh(); });

seedIfEmpty().catch((e) => console.error("seed", e)).finally(() => {
  ["tutors", "students", "pairs", "sessions"].forEach(listen);
});
render();
