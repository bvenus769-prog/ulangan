(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const LS_KEY = 'cbt_state_v1';

  let S = null;            // state ujian (disimpan ke localStorage agar tahan refresh)
  let soalMap = {};
  let timerId = null;
  let examActive = false;
  let submitting = false;
  let lastViolationAt = 0;

  // ---------- Util ----------
  function showScreen(id) {
    ['screen-login', 'screen-exam', 'screen-result'].forEach((s) => $(s).classList.toggle('hidden', s !== id));
  }
  const fsEl = () => document.fullscreenElement || document.webkitFullscreenElement;
  function requestFs() {
    const el = document.documentElement;
    const fn = el.requestFullscreen || el.webkitRequestFullscreen;
    if (!fn) return Promise.reject(new Error('Browser/perangkat ini tidak mendukung mode layar penuh. Gunakan Chrome/Edge di laptop atau Android.'));
    try {
      const r = fn.call(el);
      return r && r.then ? r : Promise.resolve();
    } catch (e) { return Promise.reject(e); }
  }
  function exitFs() {
    try {
      if (fsEl()) {
        const p = (document.exitFullscreen || document.webkitExitFullscreen).call(document);
        if (p && p.catch) p.catch(() => {});
      }
    } catch (e) { /* abaikan */ }
  }
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }
  function save() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(S)); } catch (e) { /* abaikan */ }
  }
  function loadSaved() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function loginError(msg) {
    const el = $('login-error');
    el.textContent = msg || '';
    el.classList.toggle('hidden', !msg);
  }
  const pad = (n) => String(n).padStart(2, '0');

  // ---------- Inisialisasi ----------
  async function init() {
    $('max-viol').textContent = CONFIG.MAX_VIOLATIONS;
    $('hd-max').textContent = CONFIG.MAX_VIOLATIONS;
    $('warn-max').textContent = CONFIG.MAX_VIOLATIONS;
    showScreen('screen-login');

    const saved = loadSaved();
    if (saved && saved.soal && saved.order) {
      // Ada sesi ujian yang belum selesai: wajib dilanjutkan, bukan mulai baru
      $('resume-box').classList.remove('hidden');
      $('login-form').classList.add('hidden');
      $('resume-info').textContent = saved.nama + ' - ' + saved.mapel;
      return;
    }

    try {
      const r = await apiGet({ action: 'mapel' });
      if (!r.ok) throw new Error(r.error);
      const sel = $('in-mapel');
      sel.innerHTML = '';
      if (!r.data.length) {
        sel.innerHTML = '<option value="">Belum ada mata pelajaran</option>';
        return;
      }
      const ph = document.createElement('option');
      ph.value = ''; ph.textContent = '-- Pilih Mata Pelajaran --';
      sel.appendChild(ph);
      r.data.forEach((m) => {
        const o = document.createElement('option');
        o.value = m.nama;
        o.textContent = m.nama + ' (' + m.jumlah + ' soal, ' + m.durasi + ' menit)';
        sel.appendChild(o);
      });
    } catch (e) {
      $('in-mapel').innerHTML = '<option value="">Gagal memuat</option>';
      loginError('Gagal memuat daftar mapel: ' + e.message);
    }
  }

  // ---------- Mulai ujian ----------
  $('login-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    loginError('');
    const nama = $('in-nama').value.trim();
    const nisn = $('in-nisn').value.trim();
    const kelas = $('in-kelas').value.trim();
    const mapel = $('in-mapel').value;
    if (!nama || !nisn || !kelas || !mapel) return loginError('Lengkapi nama, NISN, kelas, dan mata pelajaran.');
    if (!/^\d{5,20}$/.test(nisn)) return loginError('NISN harus berupa angka (minimal 5 digit).');

    const btn = $('btn-start');
    btn.disabled = true;
    btn.textContent = 'Memuat...';
    try {
      // Fullscreen WAJIB diminta langsung dari klik (user gesture), sebelum fetch
      try { await requestFs(); }
      catch (e) {
        throw new Error('Ujian tidak dapat dimulai tanpa layar penuh. ' + (e.message || ''));
      }
      const r = await apiGet({ action: 'soal', mapel: mapel });
      if (!r.ok) throw new Error(r.error);
      if (!r.soal.length) throw new Error('Soal belum tersedia.');

      S = {
        nama: nama, nisn: nisn, kelas: kelas, mapel: r.mapel, durasi: r.durasi,
        soal: r.soal,
        order: shuffle(r.soal.map((q) => q.id)),   // soal diacak di frontend
        answers: {}, ragu: {}, idx: 0,
        endTime: Date.now() + r.durasi * 60000,
        violations: 0, clientId: uid(), pendingStatus: null
      };
      startExam();
    } catch (e) {
      exitFs();
      loginError(e.message);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Mulai Ujian';
    }
  });

  $('btn-resume').addEventListener('click', async () => {
    const saved = loadSaved();
    if (!saved) return location.reload();
    try {
      await requestFs();
    } catch (e) {
      return loginError('Wajib layar penuh untuk melanjutkan. ' + (e.message || ''));
    }
    S = saved;
    startExam();
    if (S.pendingStatus) { submit(S.pendingStatus); return; }
    lastViolationAt = 0;
    violation('Halaman ujian dimuat ulang.');
  });

  function startExam() {
    soalMap = {};
    S.soal.forEach((q) => { soalMap[q.id] = q; });
    $('hd-nama').textContent = S.nama + ' (' + S.nisn + ')' + (S.kelas ? ' - ' + S.kelas : '');
    $('hd-mapel').textContent = S.mapel;
    showScreen('screen-exam');
    $('overlay-warning').classList.add('hidden');
    examActive = true;
    submitting = false;
    updateViol();
    render();
    tick();
    clearInterval(timerId);
    timerId = setInterval(tick, 500);
    save();
  }

  // ---------- Timer ----------
  function tick() {
    const remain = Math.max(0, S.endTime - Date.now());
    const s = Math.ceil(remain / 1000);
    $('timer').textContent = pad(Math.floor(s / 3600)) + ':' + pad(Math.floor((s % 3600) / 60)) + ':' + pad(s % 60);
    $('timer').classList.toggle('low', s <= 300);
    if (remain <= 0 && examActive) submit('Waktu Habis');
  }

  // ---------- Render soal ----------
  function render() {
    const id = S.order[S.idx];
    const q = soalMap[id];
    $('q-no').textContent = 'Soal No. ' + (S.idx + 1) + ' dari ' + S.order.length;
    $('q-text').textContent = q.q;
    const box = $('q-options');
    box.innerHTML = '';
    Object.keys(q.o).forEach((L) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'opt' + (S.answers[id] === L ? ' selected' : '');
      const k = document.createElement('span'); k.className = 'opt-key'; k.textContent = L;
      const t = document.createElement('span'); t.className = 'opt-text'; t.textContent = q.o[L];
      b.append(k, t);
      b.addEventListener('click', () => { S.answers[id] = L; save(); render(); });
      box.appendChild(b);
    });
    $('btn-ragu').classList.toggle('active', !!S.ragu[id]);
    $('btn-prev').disabled = S.idx === 0;
    $('btn-next').textContent = S.idx === S.order.length - 1 ? 'Selesai' : 'Selanjutnya »';
    buildGrid();
  }

  function buildGrid() {
    const g = $('grid');
    g.innerHTML = '';
    S.order.forEach((id, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = i + 1;
      let cls = 'gn';
      if (S.ragu[id]) cls += ' ragu';
      else if (S.answers[id]) cls += ' ans';
      if (i === S.idx) cls += ' cur';
      b.className = cls;
      b.addEventListener('click', () => { S.idx = i; save(); render(); });
      g.appendChild(b);
    });
  }

  $('btn-prev').addEventListener('click', () => { if (S.idx > 0) { S.idx--; save(); render(); } });
  $('btn-next').addEventListener('click', () => {
    if (S.idx < S.order.length - 1) { S.idx++; save(); render(); }
    else openConfirm();
  });
  $('btn-ragu').addEventListener('click', () => {
    const id = S.order[S.idx];
    if (S.ragu[id]) delete S.ragu[id]; else S.ragu[id] = true;
    save(); render();
  });
  $('btn-clear').addEventListener('click', () => {
    delete S.answers[S.order[S.idx]];
    save(); render();
  });
  $('btn-finish').addEventListener('click', openConfirm);

  // ---------- Konfirmasi selesai ----------
  function openConfirm() {
    const total = S.order.length;
    const dijawab = S.order.filter((id) => S.answers[id]).length;
    const ragu = S.order.filter((id) => S.ragu[id]).length;
    let info = 'Terjawab: ' + dijawab + ' dari ' + total + ' soal. Belum dijawab: ' + (total - dijawab) + '.';
    if (ragu) info += ' Ditandai ragu-ragu: ' + ragu + '.';
    $('confirm-info').textContent = info + ' Setelah dikirim, jawaban tidak dapat diubah.';
    $('overlay-confirm').classList.remove('hidden');
  }
  $('btn-confirm-no').addEventListener('click', () => $('overlay-confirm').classList.add('hidden'));
  $('btn-confirm-yes').addEventListener('click', () => {
    $('overlay-confirm').classList.add('hidden');
    submit('Selesai');
  });

  // ---------- Anti-curang ----------
  function updateViol() { $('hd-viol').textContent = S.violations; }

  function violation(reason) {
    if (!examActive) return;
    const now = Date.now();
    if (now - lastViolationAt < 2000) return;   // satu kejadian bisa memicu beberapa event sekaligus
    lastViolationAt = now;
    S.violations++;
    save();
    updateViol();
    if (S.violations >= CONFIG.MAX_VIOLATIONS) {
      submit('Dihentikan (Pelanggaran)');
      return;
    }
    $('warn-msg').textContent = reason;
    $('warn-count').textContent = S.violations;
    $('warn-err').textContent = '';
    $('overlay-warning').classList.remove('hidden');
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) violation('Anda berpindah tab atau meminimalkan browser.');
  });
  window.addEventListener('blur', () => {
    violation('Jendela ujian kehilangan fokus (pindah aplikasi / split screen).');
  });
  function onFsChange() {
    if (!examActive || fsEl()) return;
    violation('Anda keluar dari mode layar penuh.');
    // Pastikan layar peringatan tampil walau pelanggaran tidak dihitung ulang (cooldown)
    if (examActive) $('overlay-warning').classList.remove('hidden');
  }
  document.addEventListener('fullscreenchange', onFsChange);
  document.addEventListener('webkitfullscreenchange', onFsChange);

  $('btn-return').addEventListener('click', async () => {
    try {
      if (!fsEl()) await requestFs();
      $('overlay-warning').classList.add('hidden');
    } catch (e) {
      $('warn-err').textContent = 'Gagal masuk layar penuh. Silakan klik tombol sekali lagi.';
    }
  });

  // Blokir klik kanan, copy/paste, dan pintasan umum
  document.addEventListener('contextmenu', (e) => { if (examActive) e.preventDefault(); });
  ['copy', 'cut', 'paste', 'dragstart'].forEach((ev) =>
    document.addEventListener(ev, (e) => { if (examActive) e.preventDefault(); }));
  document.addEventListener('keydown', (e) => {
    if (!examActive) return;
    const k = e.key.toLowerCase();
    const blocked = e.key === 'F12' || e.key === 'PrintScreen' ||
      ((e.ctrlKey || e.metaKey) && ['c', 'v', 'x', 'a', 'p', 's', 'u'].includes(k)) ||
      ((e.ctrlKey || e.metaKey) && e.shiftKey && ['i', 'j', 'c'].includes(k));
    if (blocked) e.preventDefault();
  });
  window.addEventListener('beforeunload', (e) => {
    if (examActive) { e.preventDefault(); e.returnValue = ''; }
  });

  // ---------- Kirim jawaban ----------
  function showSubmit(title, msg, canRetry) {
    $('sub-title').textContent = title;
    $('sub-msg').textContent = msg || '';
    $('btn-retry').classList.toggle('hidden', !canRetry);
    $('overlay-submit').classList.remove('hidden');
    $('overlay-warning').classList.add('hidden');
    $('overlay-confirm').classList.add('hidden');
  }

  async function submit(status) {
    if (submitting) return;
    submitting = true;
    examActive = false;
    clearInterval(timerId);
    S.pendingStatus = status;
    save();
    showSubmit('Mengirim jawaban...', 'Mohon tunggu, jangan menutup halaman ini.', false);

    const payload = {
      action: 'submit', nama: S.nama, nisn: S.nisn, kelas: S.kelas || '', mapel: S.mapel,
      jawaban: S.answers, pelanggaran: S.violations, status: status, clientId: S.clientId
    };
    try {
      const r = await apiPost(payload);
      if (r.ok) return finish(status, r, null);
      if (r.final) return finish(status, null, r.error);
      throw new Error(r.error || 'Gagal menyimpan.');
    } catch (e) {
      submitting = false;
      showSubmit('Gagal mengirim jawaban', e.message + '\nPeriksa koneksi internet lalu klik Kirim Ulang. Jangan tutup halaman ini.', true);
    }
  }
  $('btn-retry').addEventListener('click', () => submit(S.pendingStatus || 'Selesai'));

  function finish(status, r, errMsg) {
    const nama = S.nama, mapel = S.mapel;
    try { localStorage.removeItem(LS_KEY); } catch (e) { /* abaikan */ }
    exitFs();
    $('overlay-submit').classList.add('hidden');
    $('res-nama').textContent = nama;
    $('res-mapel').textContent = mapel;
    $('res-status').textContent = 'Status: ' + status;
    if (r && CONFIG.SHOW_SCORE) {
      $('res-score').classList.remove('hidden');
      $('res-nilai').textContent = r.nilai;
      $('res-detail').textContent = 'Benar ' + r.benar + ' | Salah ' + r.salah + ' | Kosong ' + r.kosong + ' (dari ' + r.total + ' soal)';
    } else {
      $('res-score').classList.add('hidden');
    }
    $('res-msg').textContent = errMsg || '';
    showScreen('screen-result');
  }

  // ---------- Pindah ke login guru (satu halaman, satu link) ----------
  function openAdminLogin() {
    if (examActive) return;
    ['screen-login', 'screen-exam', 'screen-result'].forEach((s) => $(s).classList.add('hidden'));
    $('admin-login').classList.remove('hidden');
  }
  $('btn-to-admin').addEventListener('click', openAdminLogin);
  $('btn-back-siswa').addEventListener('click', () => {
    $('admin-login').classList.add('hidden');
    showScreen('screen-login');
  });

  init();
  if (location.hash === '#guru') openAdminLogin();
})();
