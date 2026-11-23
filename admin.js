(function () {
  'use strict';

  // Password sementara (hardcoded). HARUS sama dengan ADMIN_KEY di Code.gs.
  // Proteksi sebenarnya ada di server (Code.gs); password ini juga dikirim ke server setiap request admin.
  const ADMIN_PASSWORD = 'admin123';
  const SS_KEY = 'cbt_admin_pw';

  const $ = (id) => document.getElementById(id);
  let adminKey = '';
  let parsedSoal = [];
  let lastData = [];
  let viewData = [];
  let lastMapel = '';

  function setMsg(id, text, ok) {
    const el = $(id);
    el.textContent = text || '';
    el.className = text ? (ok ? 'ok' : 'error') : 'hidden';
  }

  // ---------- Login ----------
  async function enter(pw) {
    if (pw !== ADMIN_PASSWORD) throw new Error('Password salah.');
    if (apiReady()) {
      const r = await apiGet({ action: 'auth', key: pw });
      if (!r.ok) throw new Error('Password ditolak server. Samakan ADMIN_KEY di Code.gs dengan ADMIN_PASSWORD di admin.js, lalu deploy ulang.');
    }
    adminKey = pw;
    try { sessionStorage.setItem(SS_KEY, pw); } catch (e) { /* abaikan */ }
    $('admin-login').classList.add('hidden');
    $('screen-login').classList.add('hidden');
    $('admin-main').classList.remove('hidden');
    loadMapel();
  }

  $('form-login').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const err = $('ad-login-err');
    err.classList.add('hidden');
    try { await enter($('ad-pass').value); }
    catch (e) { err.textContent = e.message; err.classList.remove('hidden'); }
  });
  $('btn-logout').addEventListener('click', () => {
    try { sessionStorage.removeItem(SS_KEY); } catch (e) { /* abaikan */ }
    location.reload();
  });
  (function autoLogin() {
    let pw = null;
    try { pw = sessionStorage.getItem(SS_KEY); } catch (e) { /* abaikan */ }
    if (pw) enter(pw).catch(() => {});
  })();

  // ---------- Parser CSV (mendukung kutip, koma dalam sel, baris baru dalam sel) ----------
  function parseCSV(text, d) {
    const rows = [];
    let row = [], f = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') {
          if (text[i + 1] === '"') { f += '"'; i++; } else q = false;
        } else f += c;
      } else if (c === '"') q = true;
      else if (c === d) { row.push(f); f = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(f); f = '';
        rows.push(row); row = [];
      } else f += c;
    }
    if (f !== '' || row.length) { row.push(f); rows.push(row); }
    return rows.filter((r) => r.some((x) => x.trim() !== ''));
  }

  function detectDelimiter(text) {
    const first = text.split(/\r?\n/)[0] || '';
    const counts = { ',': 0, ';': 0, '\t': 0 };
    let q = false;
    for (const c of first) {
      if (c === '"') q = !q;
      else if (!q && counts[c] !== undefined) counts[c]++;
    }
    return Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
  }

  const norm = (h) => String(h).replace(/^\uFEFF/, '').toLowerCase().replace(/[^a-z0-9]/g, '');

  function parseSoalCSV(text) {
    text = text.replace(/^\uFEFF/, '');
    const rows = parseCSV(text, detectDelimiter(text));
    if (rows.length < 2) throw new Error('CSV kosong atau hanya berisi header.');
    const head = rows[0].map(norm);
    const need = { pertanyaan: ['pertanyaan', 'soal'], a: ['opsia', 'a'], b: ['opsib', 'b'], c: ['opsic', 'c'], d: ['opsid', 'd'], e: ['opsie', 'e'], kunci: ['kunci', 'kuncijawaban', 'jawaban'] };
    const col = {};
    for (const k in need) {
      col[k] = head.findIndex((h) => need[k].indexOf(h) >= 0);
      if (col[k] < 0 && k !== 'e') throw new Error('Kolom "' + k + '" tidak ditemukan di header CSV. Gunakan template yang disediakan.');
    }
    return rows.slice(1).map((r) => {
      const g = (k) => (col[k] >= 0 && r[col[k]] !== undefined ? r[col[k]].trim() : '');
      return { pertanyaan: g('pertanyaan'), a: g('a'), b: g('b'), c: g('c'), d: g('d'), e: g('e'), kunci: g('kunci').toUpperCase() };
    });
  }

  // ---------- Upload soal ----------
  $('up-file').addEventListener('change', async () => {
    parsedSoal = [];
    $('btn-upload').disabled = true;
    setMsg('up-msg', '');
    $('up-preview').textContent = '';
    const f = $('up-file').files[0];
    if (!f) return;
    try {
      parsedSoal = parseSoalCSV(await f.text());
      $('up-preview').textContent = parsedSoal.length + ' soal terbaca. Contoh soal 1: "' + parsedSoal[0].pertanyaan.slice(0, 80) + '" (kunci: ' + parsedSoal[0].kunci + ')';
      $('btn-upload').disabled = false;
    } catch (e) {
      setMsg('up-msg', e.message, false);
    }
  });

  $('btn-upload').addEventListener('click', async () => {
    const mapel = $('up-mapel').value.trim();
    const durasi = Number($('up-durasi').value);
    if (!mapel) return setMsg('up-msg', 'Nama mapel wajib diisi.', false);
    if (!(durasi > 0)) return setMsg('up-msg', 'Durasi harus lebih dari 0 menit.', false);
    if (!parsedSoal.length) return setMsg('up-msg', 'Pilih file CSV terlebih dahulu.', false);

    const btn = $('btn-upload');
    btn.disabled = true;
    btn.textContent = 'Mengunggah...';
    setMsg('up-msg', '');
    try {
      const r = await apiPost({ action: 'upload', key: adminKey, mapel: mapel, durasi: durasi, soal: parsedSoal });
      if (!r.ok) throw new Error(r.error);
      setMsg('up-msg', (r.baru ? 'Mapel baru dibuat. ' : 'Bank soal diperbarui. ') + r.jumlah + ' soal tersimpan.\nSheet: ' + r.sheetSoal + ' & ' + r.sheetHasil, true);
      loadMapel();
    } catch (e) {
      setMsg('up-msg', e.message, false);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Upload Soal';
    }
  });

  // ---------- Rekap nilai ----------
  async function loadMapel() {
    const sel = $('rk-mapel');
    try {
      const r = await apiGet({ action: 'mapel' });
      if (!r.ok) throw new Error(r.error);
      sel.innerHTML = '';
      if (!r.data.length) { sel.innerHTML = '<option value="">Belum ada mapel</option>'; return; }
      r.data.forEach((m) => {
        const o = document.createElement('option');
        o.value = m.nama; o.textContent = m.nama;
        sel.appendChild(o);
      });
    } catch (e) {
      setMsg('rk-msg', 'Gagal memuat mapel: ' + e.message, false);
    }
  }
  $('btn-refresh').addEventListener('click', loadMapel);

  $('btn-load').addEventListener('click', async () => {
    const mapel = $('rk-mapel').value;
    if (!mapel) return setMsg('rk-msg', 'Pilih mata pelajaran.', false);
    const btn = $('btn-load');
    btn.disabled = true;
    setMsg('rk-msg', 'Memuat...', true);
    try {
      const r = await apiGet({ action: 'hasil', mapel: mapel, key: adminKey });
      if (!r.ok) throw new Error(r.error);
      lastData = r.data;
      lastMapel = r.mapel;
      const kelasList = Array.from(new Set(r.data.map((x) => x.kelas).filter(Boolean))).sort();
      const ks = $('rk-kelas');
      ks.innerHTML = '<option value="">Semua Kelas</option>';
      kelasList.forEach((k) => {
        const o = document.createElement('option');
        o.value = k; o.textContent = k;
        ks.appendChild(o);
      });
      applyFilter();
      setMsg('rk-msg', r.data.length ? '' : 'Belum ada siswa yang mengerjakan mapel ini.', true);
    } catch (e) {
      setMsg('rk-msg', e.message, false);
    } finally {
      btn.disabled = false;
    }
  });

  function applyFilter() {
    const k = $('rk-kelas').value;
    viewData = k ? lastData.filter((r) => r.kelas === k) : lastData;
    renderTable(viewData);
  }
  $('rk-kelas').addEventListener('change', applyFilter);

  function cell(tr, text) {
    const td = document.createElement('td');
    td.textContent = text;
    tr.appendChild(td);
  }

  function renderTable(data) {
    const tbody = $('rk-table').querySelector('tbody');
    tbody.innerHTML = '';
    data.forEach((r, i) => {
      const tr = document.createElement('tr');
      [i + 1, r.waktu, r.nama, r.nisn, r.kelas, r.benar, r.salah, r.kosong, r.nilai, r.pelanggaran, r.status].forEach((v) => cell(tr, v));
      tbody.appendChild(tr);
    });
    $('rk-table').classList.toggle('hidden', !data.length);
    $('btn-export').disabled = !data.length;

    const stats = $('rk-stats');
    stats.innerHTML = '';
    if (!data.length) return;
    const nilai = data.map((r) => Number(r.nilai) || 0);
    const avg = nilai.reduce((a, b) => a + b, 0) / nilai.length;
    [['Peserta', data.length], ['Rata-rata', avg.toFixed(2)], ['Tertinggi', Math.max.apply(null, nilai)], ['Terendah', Math.min.apply(null, nilai)]]
      .forEach(([label, val]) => {
        const d = document.createElement('div');
        d.className = 'stat';
        const b = document.createElement('b');
        b.textContent = val;
        d.append(b, label);
        stats.appendChild(d);
      });
  }

  $('btn-export').addEventListener('click', () => {
    const esc = (v) => {
      let s = String(v == null ? '' : v);
      if (/^[=+\-@]/.test(s)) s = "'" + s;   // cegah formula injection di Excel
      return '"' + s.replace(/"/g, '""') + '"';
    };
    const head = ['No', 'Waktu', 'Nama', 'NISN', 'Kelas', 'Benar', 'Salah', 'Kosong', 'Nilai', 'Pelanggaran', 'Status'];
    const lines = [head.map(esc).join(',')];
    viewData.forEach((r, i) => lines.push([i + 1, r.waktu, r.nama, r.nisn, r.kelas, r.benar, r.salah, r.kosong, r.nilai, r.pelanggaran, r.status].map(esc).join(',')));
    const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'Hasil_' + lastMapel.replace(/[^A-Za-z0-9]+/g, '_') + '.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
  });
})();
