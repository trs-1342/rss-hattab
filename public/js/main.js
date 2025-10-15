// public/js/main.js
async function api(path, opts = {}) {
  const res = await fetch(
    path,
    Object.assign(
      {
        headers: { "Content-Type": "application/json" },
      },
      opts
    )
  );
  if (!res.ok) {
    let msg = "İstek hatası";
    try {
      const j = await res.json();
      msg = j.error || msg;
    } catch {}
    throw new Error(msg);
  }
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function qs(name) {
  const p = new URLSearchParams(location.search);
  return p.get(name);
}

async function currentUser() {
  try {
    const { user } = await api("/api/me");
    return user;
  } catch {
    return null;
  }
}

function fmtDate(iso) {
  const d = new Date(iso);
  return d.toLocaleString();
}
