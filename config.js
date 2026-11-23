// ====== KONFIGURASI BERSAMA (dipakai index.html & admin.html) ======
const CONFIG = {
  API_URL: "https://script.google.com/macros/s/AKfycbxzZ9w1snqjLs2h9gGLviGWwS5CZZb-tvLLKvZkrTUMvL6sungLSijb5qscdASPs8Bx/exec", // contoh: https://script.google.com/macros/s/AKfycb.../exec
  MAX_VIOLATIONS: 3,                        // batas pelanggaran sebelum ujian dihentikan paksa
  SHOW_SCORE: true                          // tampilkan nilai ke siswa setelah selesai?
};

function apiReady() {
  return CONFIG.API_URL && CONFIG.API_URL.indexOf("script.google.com") !== -1;
}

async function apiGet(params) {
  if (!apiReady()) throw new Error("API_URL belum diisi di config.js");
  const res = await fetch(CONFIG.API_URL + "?" + new URLSearchParams(params).toString());
  if (!res.ok) throw new Error("Server error (" + res.status + ")");
  return res.json();
}

// Content-Type text/plain agar tidak memicu preflight CORS (GAS tidak mendukung OPTIONS)
async function apiPost(body) {
  if (!apiReady()) throw new Error("API_URL belum diisi di config.js");
  const res = await fetch(CONFIG.API_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error("Server error (" + res.status + ")");
  return res.json();
}
