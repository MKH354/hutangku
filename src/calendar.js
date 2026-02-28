/* ─── ICS Calendar Utilities ─── */

const pad = (n) => String(n).padStart(2, "0");

function toICSDate(dateStr) {
  const d = new Date(dateStr);
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

function toICSDatetime(d = new Date()) {
  return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}Z`;
}

function nextDay(dateStr) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

function fmt(n) {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", minimumFractionDigits: 0 }).format(n);
}

/**
 * Buat satu VEVENT untuk hutang biasa (jatuh tempo)
 */
function makeHutangEvent(r) {
  if (!r.dueDate || r.status === "lunas") return null;
  const sisa = Math.max(0, r.amount - (r.payments || []).reduce((a, b) => a + b.amount, 0));
  return `BEGIN:VEVENT
UID:hutangku-${r.id}@hutangku
DTSTAMP:${toICSDatetime()}
DTSTART;VALUE=DATE:${toICSDate(r.dueDate)}
DTEND;VALUE=DATE:${nextDay(r.dueDate)}
SUMMARY:💸 JT Hutang: ${r.name}
DESCRIPTION:Hutang kepada ${r.name}\\nTotal: ${fmt(r.amount)}\\nSisa: ${fmt(sisa)}${r.description ? "\\nKet: " + r.description : ""}
BEGIN:VALARM
TRIGGER:-P1D
ACTION:DISPLAY
DESCRIPTION:Besok jatuh tempo hutang ke ${r.name} - Sisa ${fmt(sisa)}
END:VALARM
BEGIN:VALARM
TRIGGER:-PT2H
ACTION:DISPLAY
DESCRIPTION:Hari ini jatuh tempo hutang ke ${r.name}!
END:VALARM
END:VEVENT`;
}

/**
 * Buat VEVENT berulang tiap bulan untuk cicilan berjalan
 */
function makeCicilanEvent(c) {
  if (c.status === "done") return null;
  const sisaAngsuran = c.totalInstallments - c.paidInstallments;
  if (sisaAngsuran <= 0) return null;

  // Hitung tanggal jatuh tempo bulan ini / berikutnya
  const today = new Date();
  let dueDate = new Date(today.getFullYear(), today.getMonth(), c.dueDay);
  if (today.getDate() >= c.dueDay) {
    dueDate = new Date(today.getFullYear(), today.getMonth() + 1, c.dueDay);
  }
  const dueDateStr = `${dueDate.getFullYear()}${pad(dueDate.getMonth()+1)}${pad(dueDate.getDate())}`;
  const nextDayStr = (() => {
    const nd = new Date(dueDate); nd.setDate(nd.getDate()+1);
    return `${nd.getFullYear()}${pad(nd.getMonth()+1)}${pad(nd.getDate())}`;
  })();

  // Hitung until date (akhir cicilan)
  const lastDue = new Date(dueDate);
  lastDue.setMonth(lastDue.getMonth() + sisaAngsuran - 1);
  const untilStr = `${lastDue.getFullYear()}${pad(lastDue.getMonth()+1)}${pad(lastDue.getDate())}`;

  const typeLabel = {
    paylater: "PayLater", pinjol: "Pinjol", angsuran: "Angsuran", kredit: "Kredit", lainnya: "Cicilan"
  }[c.type] || "Cicilan";

  return `BEGIN:VEVENT
UID:hutangku-cicilan-${c.id}@hutangku
DTSTAMP:${toICSDatetime()}
DTSTART;VALUE=DATE:${dueDateStr}
DTEND;VALUE=DATE:${nextDayStr}
RRULE:FREQ=MONTHLY;COUNT=${sisaAngsuran};UNTIL=${untilStr}
SUMMARY:🔄 ${typeLabel}: ${c.name}
DESCRIPTION:${typeLabel} ${c.name}\\nAngsuran/bulan: ${fmt(c.installmentAmount)}\\nSisa: ${sisaAngsuran}x dari ${c.totalInstallments}x${c.notes ? "\\nCatatan: " + c.notes : ""}
BEGIN:VALARM
TRIGGER:-P2D
ACTION:DISPLAY
DESCRIPTION:Lusa jatuh tempo ${typeLabel} ${c.name} - ${fmt(c.installmentAmount)}
END:VALARM
BEGIN:VALARM
TRIGGER:-PT6H
ACTION:DISPLAY
DESCRIPTION:Hari ini jatuh tempo ${typeLabel} ${c.name}!
END:VALARM
END:VEVENT`;
}

/**
 * Export semua event ke file .ics dan trigger download
 */
export function exportAllToCalendar(records, cicilans) {
  const events = [
    ...(records || []).map(makeHutangEvent),
    ...(cicilans || []).map(makeCicilanEvent),
  ].filter(Boolean);

  if (events.length === 0) return false;

  const ics = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//HutangKu//HutangKu App 2.0//ID
CALSCALE:GREGORIAN
METHOD:PUBLISH
X-WR-CALNAME:HutangKu - Pengingat Jatuh Tempo
X-WR-TIMEZONE:Asia/Jakarta
${events.join("\n")}
END:VCALENDAR`;

  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "hutangku-jadwal.ics";
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  return true;
}

/**
 * Export satu item saja ke .ics
 */
export function exportOneToCalendar(item, type = "hutang") {
  const event = type === "hutang" ? makeHutangEvent(item) : makeCicilanEvent(item);
  if (!event) return false;

  const ics = `BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//HutangKu//HutangKu App//ID\n${event}\nEND:VCALENDAR`;
  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `hutangku-${item.name.replace(/\s+/g,"-")}.ics`;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  return true;
}

/**
 * Hitung tanggal jatuh tempo berikutnya untuk cicilan
 */
export function getNextDueDate(c) {
  const today = new Date();
  let due = new Date(today.getFullYear(), today.getMonth(), c.dueDay);
  if (today.getDate() >= c.dueDay) {
    due = new Date(today.getFullYear(), today.getMonth() + 1, c.dueDay);
  }
  return due;
}

/**
 * Berapa hari lagi jatuh tempo
 */
export function daysUntil(date) {
  const today = new Date(); today.setHours(0,0,0,0);
  const d = new Date(date); d.setHours(0,0,0,0);
  return Math.round((d - today) / 86400000);
}
