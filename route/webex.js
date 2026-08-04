<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Appels — Tableau de bord MDA</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --blue: #0004F2; --charbon: #1C1F2C; --yellow: #FFEA00;
      --mint: #16E0BD; --azure: #019DF1; --border: #E2E2EB;
      --off: #F5F5F8; --radius: 12px; --text: #1C1F2C; --muted: #6B6E82;
      --shadow: 0 2px 12px rgba(0,4,242,.07);
    }
    body { font-family: 'Segoe UI', Calibri, sans-serif; background: var(--off); color: var(--text); min-height: 100vh; }

    header { background: var(--charbon); color: white; padding: 16px 32px; display: flex; align-items: center; gap: 16px; }
    .logo { background: var(--blue); color: var(--yellow); font-weight: 800; font-size: 16px; letter-spacing: 2px; padding: 6px 10px; border-radius: 5px; }
    .header-title { font-size: 16px; font-weight: 700; }
    .header-sub { font-size: 12px; color: #aaa; }

    main { max-width: 1100px; margin: 0 auto; padding: 28px 24px 60px; }

    /* Upload zone */
    .upload-zone {
      background: white; border: 2px dashed var(--border); border-radius: var(--radius);
      padding: 28px; text-align: center; cursor: pointer; transition: all .2s;
      margin-bottom: 12px;
    }
    .upload-zone:hover, .upload-zone.drag { border-color: var(--blue); background: rgba(0,4,242,.03); }
    .upload-icon { font-size: 32px; margin-bottom: 8px; }
    .upload-title { font-size: 15px; font-weight: 700; color: var(--charbon); margin-bottom: 4px; }
    .upload-sub { font-size: 12px; color: var(--muted); }
    #file-input { display: none; }

    .upload-results { margin-bottom: 20px; }
    .upload-result { background: white; border-radius: var(--radius); padding: 10px 16px; margin-bottom: 6px; font-size: 13px; box-shadow: var(--shadow); display: flex; align-items: center; gap: 10px; }
    .upload-result--ok  { border-left: 4px solid var(--mint); }
    .upload-result--err { border-left: 4px solid #c53030; color: #c53030; }
    .upload-result--pending { border-left: 4px solid var(--border); color: var(--muted); }

    .import-status {
      background: white; border-radius: var(--radius); padding: 12px 18px;
      margin-bottom: 20px; font-size: 13px; color: var(--muted);
      display: flex; align-items: center; gap: 10px; box-shadow: var(--shadow);
    }
    .import-status strong { color: var(--charbon); }

    .top-bar { display: flex; align-items: center; gap: 12px; margin-bottom: 20px; flex-wrap: wrap; }
    .top-bar h2 { font-size: 20px; font-weight: 800; flex: 1; }
    input[type=date] { border: 1px solid var(--border); border-radius: var(--radius); padding: 8px 12px; font-size: 14px; font-family: inherit; }
    .btn { padding: 9px 18px; border: none; border-radius: var(--radius); font-size: 14px; font-family: inherit; font-weight: 600; cursor: pointer; }
    .btn--primary { background: var(--blue); color: white; }
    .btn--ghost { background: white; border: 1.5px solid var(--border); color: var(--text); }

    /* Stats cards */
    .stats-cards { display: grid; grid-template-columns: repeat(6, 1fr); gap: 16px; margin-bottom: 24px; }
    .stat-card { background: white; border-radius: var(--radius); padding: 20px; box-shadow: var(--shadow); border-top: 4px solid var(--border); }
    .stat-card--total  { border-color: var(--blue); }
    .stat-card--dec    { border-color: var(--mint); }
    .stat-card--manq   { border-color: #f0ad00; }
    .stat-card--duree  { border-color: var(--azure); }
    .stat-card--attente{ border-color: #6831FF; }
    .stat-card--uniq   { border-color: #1C1F2C; }
    .stat-card__val   { font-size: 36px; font-weight: 800; color: var(--charbon); }
    .stat-card__label { font-size: 13px; color: var(--muted); margin-top: 4px; }
    .stat-card__sub   { font-size: 12px; color: var(--muted); margin-top: 2px; }

    .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 20px; }
    .section { background: white; border-radius: var(--radius); padding: 20px 24px; box-shadow: var(--shadow); }
    .section h3 { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .5px; color: var(--muted); margin-bottom: 14px; }

    .bar-row { display: grid; grid-template-columns: 90px 1fr 50px; align-items: center; gap: 10px; margin-bottom: 8px; }
    .bar-label { font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .bar-track { height: 10px; background: var(--border); border-radius: 5px; overflow: hidden; }
    .bar-fill  { height: 100%; border-radius: 5px; }
    .bar-val   { font-size: 13px; font-weight: 700; text-align: right; }

    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th { text-align: left; padding: 8px 12px; background: var(--charbon); color: white; font-size: 12px; }
    td { padding: 9px 12px; border-bottom: 1px solid var(--border); }
    tr:last-child td { border-bottom: none; }
    tr:hover td { background: var(--off); }

    .badge { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 700; }
    .badge--dec  { background: rgba(22,224,189,.2); color: #0d8a74; }
    .badge--manq { background: rgba(240,173,0,.2); color: #7a5600; }

    .section--full { margin-bottom: 20px; }
    .login-wrap { display: flex; align-items: center; justify-content: center; min-height: 60vh; }
    .login-card { background: white; border-radius: var(--radius); padding: 32px; max-width: 360px; width: 100%; box-shadow: var(--shadow); }
    .login-card h2 { font-size: 18px; margin-bottom: 20px; }
    .login-form { display: flex; flex-direction: column; gap: 12px; }
    .login-form input { border: 1.5px solid var(--border); border-radius: var(--radius); padding: 12px 14px; font-size: 15px; font-family: inherit; }
    .login-form .err { color: #c53030; font-size: 13px; background: #fff5f5; padding: 8px 12px; border-radius: 8px; display: none; }
    .empty { text-align: center; padding: 48px; color: var(--muted); font-size: 15px; }

    footer { text-align: center; padding: 16px; font-size: 12px; color: var(--muted); border-top: 1px solid var(--border); }

    @media (max-width: 900px) {
      .stats-cards { grid-template-columns: 1fr 1fr 1fr; }
    }
    @media (max-width: 700px) {
      .stats-cards { grid-template-columns: 1fr 1fr; }
      .grid2 { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>

<header>
  <div class="logo">MDA</div>
  <div>
    <div class="header-title">Tableau de bord — Appels téléphoniques</div>
    <div class="header-sub">La Maison des Artistes · Statistiques officielles Webex</div>
  </div>
</header>

<main id="main">
  <!-- Login -->
  <div class="login-wrap" id="login-screen">
    <div class="login-card">
      <h2>Connexion</h2>
      <form class="login-form" id="login-form">
        <input id="login-user" type="text" placeholder="Identifiant" required />
        <input id="login-pwd" type="password" placeholder="Mot de passe" required />
        <div class="err" id="login-err"></div>
        <button type="submit" class="btn btn--primary" style="padding:13px">Se connecter</button>
      </form>
    </div>
  </div>

  <!-- Dashboard -->
  <div id="dashboard" style="display:none">
    <div class="top-bar">
      <h2>Statistiques d'appels</h2>
      <input type="date" id="from" />
      <input type="date" id="to" />
      <button class="btn btn--ghost" onclick="setThisWeek()">Cette semaine</button>
      <button class="btn btn--ghost" onclick="setThisMonth()">Ce mois</button>
      <button class="btn btn--ghost" onclick="setAllData()">Tout l'historique</button>
      <button class="btn btn--primary" onclick="loadStats()">Filtrer</button>
      <button class="btn btn--ghost" onclick="logout()" title="Se déconnecter">⎋ Déconnexion</button>
    </div>

    <!-- Upload -->
    <div class="upload-zone" id="upload-zone" onclick="document.getElementById('file-input').click()"
         ondragover="event.preventDefault();this.classList.add('drag')"
         ondragleave="this.classList.remove('drag')"
         ondrop="handleDrop(event)">
      <div class="upload-icon">📂</div>
      <div class="upload-title">Importer vos exports Webex et Orange Business</div>
      <div class="upload-sub">Glissez-déposez un ou plusieurs CSV (group_statistics, agent_statistics, CallDetails) — le type est détecté automatiquement au nom du fichier</div>
    </div>
    <input type="file" id="file-input" accept=".csv" multiple onchange="handleFiles(this.files)">

    <div class="upload-results" id="upload-results"></div>

    <div class="import-status" id="import-status">Chargement…</div>

    <div class="section section--full" style="margin-bottom:20px">
      <h3 style="display:flex;align-items:center;justify-content:space-between">
        Historique des imports
        <button class="btn btn--ghost" style="padding:4px 12px;font-size:12px" onclick="loadImportHistory()">↻ Actualiser</button>
      </h3>
      <div id="import-history"><div class="empty">Chargement…</div></div>
    </div>

    <div id="content"><div class="empty">Chargement des statistiques…</div></div>
  </div>
</main>

<footer>Tous droits réservés © La Maison des Artistes · art. L111-1 du CPI</footer>

<script>
  const API_URL = 'https://mda-permanences-api.onrender.com';
  let token = sessionStorage.getItem('mda_token') || localStorage.getItem('mda_token');
  let useAllData = false;

  // Auth
  document.getElementById('login-form').addEventListener('submit', async e => {
    e.preventDefault();
    const err = document.getElementById('login-err');
    try {
      const res = await fetch(`${API_URL}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: document.getElementById('login-user').value, password: document.getElementById('login-pwd').value })
      });
      if (!res.ok) throw new Error('Identifiants incorrects');
      const { token: t } = await res.json();
      token = t;
      sessionStorage.setItem('mda_token', t);
      localStorage.setItem('mda_token', t);
      showDashboard();
    } catch(e) {
      err.textContent = e.message; err.style.display = 'block';
    }
  });

  function showDashboard() {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('dashboard').style.display = 'block';
    loadStats();
    loadImportHistory();
  }

  if (token) showDashboard();

  function logout() {
    localStorage.removeItem('mda_token');
    sessionStorage.removeItem('mda_token');
    token = '';
    document.getElementById('dashboard').style.display = 'none';
    document.getElementById('login-screen').style.display = 'flex';
  }

  // Dates
  function setThisWeek() {
    useAllData = false;
    const now = new Date(), day = now.getDay() || 7;
    const mon = new Date(now); mon.setDate(now.getDate() - day + 1);
    document.getElementById('from').value = mon.toISOString().slice(0,10);
    document.getElementById('to').value   = now.toISOString().slice(0,10);
    loadStats();
  }
  function setThisMonth() {
    useAllData = false;
    const now = new Date();
    document.getElementById('from').value = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`;
    document.getElementById('to').value   = now.toISOString().slice(0,10);
    loadStats();
  }
  function setAllData() {
    useAllData = true;
    document.getElementById('from').value = '';
    document.getElementById('to').value = '';
    loadStats();
  }

  // Import multi-fichiers : le type (group / agent) est déterminé par le nom de fichier,
  // convention Webex : "AAAAMMJJ_hhmmss_group_statistics.csv" / "..._agent_statistics.csv"
  function handleDrop(e) {
    e.preventDefault();
    document.getElementById('upload-zone').classList.remove('drag');
    if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
  }

  function detecterType(filename) {
    const n = filename.toLowerCase();
    if (n.includes('group_statistics')) return 'group';
    if (n.includes('agent_statistics')) return 'agent';
    if (n.includes('calldetails')) return 'calldetails';
    return null;
  }

  function readAsLatin1(file) {
    // Les exports Webex sont encodés en ISO-8859-1 (accents), pas en UTF-8.
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => resolve(e.target.result);
      reader.onerror = reject;
      reader.readAsText(file, 'ISO-8859-1');
    });
  }

  async function handleFiles(fileList) {
    const files = Array.from(fileList);
    const resultsEl = document.getElementById('upload-results');
    resultsEl.innerHTML = '';

    const rows = files.map(f => {
      const div = document.createElement('div');
      div.className = 'upload-result upload-result--pending';
      div.textContent = `⏳ ${f.name}`;
      resultsEl.appendChild(div);
      return div;
    });

    let ok = 0;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const row = rows[i];
      const type = detecterType(file.name);
      if (!type) {
        row.className = 'upload-result upload-result--err';
        row.textContent = `✗ ${file.name} — nom non reconnu (attendu "..._group_statistics.csv", "..._agent_statistics.csv" ou "..._CallDetails.csv")`;
        continue;
      }
      try {
        const csv = await readAsLatin1(file);
        const endpoint = type === 'group' ? '/webex/import/group'
          : type === 'agent' ? '/webex/import/agents'
          : '/calls/import';
        const res = await fetch(`${API_URL}${endpoint}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': token },
          body: JSON.stringify({ csv, filename: file.name })
        });
        if (res.status === 401) { logout(); return; }
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Erreur import');
        row.className = 'upload-result upload-result--ok';
        row.textContent = `✓ ${file.name} — ${data.total} ligne(s), ${data.inserted} nouvelle(s), ${data.updated} mise(s) à jour`;
        ok++;
      } catch (err) {
        row.className = 'upload-result upload-result--err';
        row.textContent = `✗ ${file.name} — ${err.message}`;
      }
    }

    if (ok > 0) {
      loadStats();
      loadImportHistory();
    }
  }

  function fmt(sec) {
    if (sec == null) return '—';
    if (!sec) return '0s';
    const h = Math.floor(sec/3600), m = Math.floor((sec%3600)/60), s = sec%60;
    if (h > 0) return `${h}h${m > 0 ? m+'m' : ''}`;
    if (m > 0) return `${m}m${s > 0 ? s+'s' : ''}`;
    return `${s}s`;
  }

  async function loadImportHistory() {
    try {
      const res = await fetch(`${API_URL}/calls/imports`, { headers: { 'Authorization': token } });
      if (res.status === 401) { logout(); return; }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      renderImportHistory(data);
    } catch(e) {
      document.getElementById('import-history').innerHTML = `<div class="empty">Historique indisponible : ${e.message}</div>`;
    }
  }

  function renderImportHistory(imports) {
    const el = document.getElementById('import-history');
    if (!imports.length) {
      el.innerHTML = '<div class="empty">Aucun import enregistré pour le moment.</div>';
      return;
    }
    el.innerHTML = `
      <table>
        <thead><tr><th>Importé le</th><th>Par</th><th>Fichier</th><th>Période couverte</th><th>Lignes</th></tr></thead>
        <tbody>
          ${imports.map(imp => {
            const dt = new Date(imp.imported_at).toLocaleString('fr-FR');
            const periode = (imp.date_min && imp.date_max)
              ? `${new Date(imp.date_min).toLocaleDateString('fr-FR')} → ${new Date(imp.date_max).toLocaleDateString('fr-FR')}`
              : '—';
            return `<tr>
              <td>${dt}</td>
              <td>${imp.imported_by || '—'}</td>
              <td>${imp.filename || '—'}</td>
              <td>${periode}</td>
              <td>${imp.total} <span style="color:var(--muted)">(${imp.inserted} nouveaux, ${imp.updated} mis à jour)</span></td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    `;
  }

  async function loadStats() {
    document.getElementById('content').innerHTML = '<div class="empty">Chargement…</div>';
    const from = useAllData ? '' : document.getElementById('from').value;
    const to   = useAllData ? '' : document.getElementById('to').value;
    try {
      const params = new URLSearchParams();
      if (from) params.set('from', from);
      if (to)   params.set('to', to);
      const res = await fetch(`${API_URL}/webex/stats?${params}`, { headers: { 'Authorization': token } });
      if (res.status === 401) { logout(); return; }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      const statusEl = document.getElementById('import-status');
      if (data.lastImport) {
        statusEl.innerHTML = `📊 Données disponibles du <strong>${data.dataRange.min ? new Date(data.dataRange.min).toLocaleDateString('fr-FR') : '?'}</strong> au <strong>${data.dataRange.max ? new Date(data.dataRange.max).toLocaleDateString('fr-FR') : '?'}</strong> — Dernier import le ${new Date(data.lastImport).toLocaleString('fr-FR')}`;
      } else {
        statusEl.innerHTML = `Aucune donnée importée. Glissez vos exports Webex (group_statistics / agent_statistics) ci-dessus.`;
      }

      if (!from && !to) {
        document.getElementById('from').value = data.periode.from ? new Date(data.periode.from).toISOString().slice(0,10) : '';
        document.getElementById('to').value   = data.periode.to   ? new Date(data.periode.to).toISOString().slice(0,10)   : '';
      }

      renderDashboard(data);
    } catch(e) {
      document.getElementById('content').innerHTML = `<div class="empty">Erreur : ${e.message}</div>`;
    }
  }

  function renderDashboard(d) {
    if (d.total === 0) {
      document.getElementById('content').innerHTML = '<div class="empty">Aucune donnée pour cette période. Importez vos exports Webex ci-dessus ou changez les dates.</div>';
      return;
    }

    const agents = d.parAgent || [];
    const heures = d.parHeure || [];
    const maxH = heures.length > 0 ? Math.max(...heures.map(h => h.total), 1) : 1;
    const jours = d.parJour || [];
    const agentsActifs = agents.filter(a => a.appelsTraites > 0).length;

    document.getElementById('content').innerHTML = `
      <div class="stats-cards">
        <div class="stat-card stat-card--total">
          <div class="stat-card__val">${d.total}</div>
          <div class="stat-card__label">Appels reçus</div>
          <div class="stat-card__sub">${d.periode.from && d.periode.to ? `Du ${new Date(d.periode.from).toLocaleDateString('fr-FR')} au ${new Date(d.periode.to).toLocaleDateString('fr-FR')}` : ''}</div>
        </div>
        <div class="stat-card stat-card--dec">
          <div class="stat-card__val">${d.answered}</div>
          <div class="stat-card__label">Décrochés</div>
          <div class="stat-card__sub">${d.tauxDecroche}% de taux de décroché</div>
        </div>
        <div class="stat-card stat-card--manq">
          <div class="stat-card__val">${d.abandoned}</div>
          <div class="stat-card__label">Abandonnés</div>
          <div class="stat-card__sub">+ ${d.overflow} débordés, ${d.transferred} transférés, ${d.timed} temporisés</div>
        </div>
        <div class="stat-card stat-card--attente">
          <div class="stat-card__val">${fmt(d.attenteMoy)}</div>
          <div class="stat-card__label">Attente moy. avant décroché</div>
          <div class="stat-card__sub">Source : group_statistics.csv</div>
        </div>
        <div class="stat-card stat-card--duree">
          <div class="stat-card__val">${fmt(d.dureeMoy)}</div>
          <div class="stat-card__label">Durée moy. de conversation</div>
          <div class="stat-card__sub">Source : agent_statistics.csv</div>
        </div>
        <div class="stat-card stat-card--uniq">
          <div class="stat-card__val">${agentsActifs}</div>
          <div class="stat-card__label">Conseiller·ères actif·ves</div>
          <div class="stat-card__sub">${agents.length} au total sur la période</div>
        </div>
      </div>

      <div class="grid2">
        <div class="section">
          <h3>Par conseiller·ère</h3>
          <table>
            <thead><tr><th>Nom</th><th>Traités</th><th>Sans réponse</th><th>Durée moy.</th></tr></thead>
            <tbody>
              ${agents.length === 0 ? '<tr><td colspan="4" class="empty">Aucune donnée</td></tr>' : agents.map(a => `
                <tr>
                  <td>${a.nom}</td>
                  <td><strong>${a.appelsTraites}</strong></td>
                  <td>${a.appelsSansReponse}</td>
                  <td>${fmt(a.dureeMoy)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>

        <div class="section">
          <h3>Par tranche horaire</h3>
          ${heures.length === 0 ? '<div class="empty">Aucune donnée</div>' : heures.map(h => `
            <div class="bar-row">
              <div class="bar-label">${h.heure}h00</div>
              <div class="bar-track"><div class="bar-fill" style="width:${Math.round(h.total/maxH*100)}%;background:var(--azure)"></div></div>
              <div class="bar-val">${h.total}</div>
            </div>
          `).join('')}
        </div>
      </div>

      <div class="section section--full">
        <h3>Détail par jour</h3>
        <table>
          <thead><tr><th>Date</th><th>Total</th><th>Décrochés</th><th>Abandonnés</th><th>Taux</th><th>Attente moy.</th></tr></thead>
          <tbody>
            ${jours.map(j => {
              const tx = j.total > 0 ? Math.round(j.answered/j.total*100) : 0;
              const jsDate = new Date(j.date+'T12:00:00');
              const label = jsDate.toLocaleDateString('fr-FR', {weekday:'short',day:'2-digit',month:'short',year:'numeric'});
              return `<tr>
                <td>${label}</td>
                <td><strong>${j.total}</strong></td>
                <td><span class="badge badge--dec">${j.answered}</span></td>
                <td><span class="badge badge--manq">${j.abandoned}</span></td>
                <td>${tx}%</td>
                <td>${fmt(j.attenteMoy)}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  }
</script>
</body>
</html>
