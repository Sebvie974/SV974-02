    // --- PWA DYNAMIQUE ---
    (function initPWA() {
        const manifest = {
            "name": "Mes Courses Pro", "short_name": "Courses Pro", "start_url": window.location.href.split('?')[0],
            "display": "standalone", "background_color": "#f8f9fa", "theme_color": "#2c3e50",
            "icons": [{ "src": "data:image/svg+xml;charset=utf-8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' fill='%2327ae60'/><text x='50' y='65' font-size='50' text-anchor='middle' fill='white'>🛒</text></svg>", "sizes": "512x512", "type": "image/svg+xml", "purpose": "any maskable" }]
        };
        const link = document.createElement('link'); link.rel = 'manifest';
        link.href = URL.createObjectURL(new Blob([JSON.stringify(manifest)], {type: 'application/manifest+json'}));
        document.head.appendChild(link);
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register(URL.createObjectURL(new Blob(["self.addEventListener('fetch', function(e) {});"], {type: 'application/javascript'}))).catch(()=>{});
        }
    })();

    // --- FIREBASE CONFIG ---
    const firebaseConfig = {
      apiKey: "AIzaSyDageL5yxmvfwQmoPLkBdy1Q86X0uVVxmA",
      authDomain: "courses-a9c65.firebaseapp.com",
      projectId: "courses-a9c65",
      storageBucket: "courses-a9c65.firebasestorage.app",
      messagingSenderId: "847747938532",
      appId: "1:847747938532:web:6754196393d36588bc54f1"
    };
    firebase.initializeApp(firebaseConfig);
    const auth = firebase.auth();
    const fs = firebase.firestore();

    let currentUser = null;
    let authMode = 'login';
    let userDb = { shops: [], budget: 0 };
    let sharedCatalogue = [];
    let sharedShops = [];

    // --- AUTHENTIFICATION ---
    function setAuthMode(mode) {
        authMode = mode;
        document.getElementById('tabLogin').classList.toggle('active', mode === 'login');
        document.getElementById('tabRegister').classList.toggle('active', mode === 'register');
        document.getElementById('authTitle').innerText = mode === 'login' ? 'Connexion' : 'Inscription';
        document.getElementById('btnForgot').style.display = mode === 'login' ? 'block' : 'none';
    }

    function handleAuth() {
        const e = document.getElementById('authEmail').value.trim();
        const p = document.getElementById('authPassword').value;
        if(!e || !p) return alert("Champs requis.");
        if (authMode === 'login') auth.signInWithEmailAndPassword(e, p).catch(err => alert("Erreur : " + err.message));
        else auth.createUserWithEmailAndPassword(e, p).catch(err => alert("Erreur : " + err.message));
    }

    function handleForgotPassword() {
        const e = document.getElementById('authEmail').value.trim();
        if(!e) return alert("Saisissez votre e-mail d'abord.");
        auth.sendPasswordResetEmail(e).then(() => alert("E-mail envoyé !")).catch(err => alert("Erreur : " + err.message));
    }

    auth.onAuthStateChanged(user => {
        if (user) {
            currentUser = user;
            document.getElementById('authScreen').style.display = 'none';
            document.getElementById('appScreen').style.display = 'flex';
            
            fs.collection('users_data').doc(user.uid).onSnapshot(doc => {
                if (doc.exists) userDb = doc.data();
                else { userDb = { shops: [], budget: 0 }; fs.collection('users_data').doc(user.uid).set(userDb); }
                render();
            });

            fs.collection('global_catalogue').onSnapshot(snapshot => {
                sharedCatalogue = [];
                snapshot.forEach(doc => sharedCatalogue.push({ id: doc.id, ...doc.data() }));
                // Met à jour la modale si elle est ouverte
                if(document.getElementById('modalCat').style.display === 'flex') renderCatList();
            });

            fs.collection('global_shops').onSnapshot(snapshot => {
                sharedShops = [];
                const dl = document.getElementById('sharedShopsList');
                dl.innerHTML = "";
                snapshot.forEach(doc => {
                    const sName = doc.data().name;
                    sharedShops.push(sName);
                    dl.innerHTML += `<option value="${sName}">`;
                });
            });

        } else {
            currentUser = null;
            document.getElementById('authScreen').style.display = 'flex';
            document.getElementById('appScreen').style.display = 'none';
        }
    });

    // --- DATA MANAGEMENT ---
    function cloudSave() {
        if (!currentUser) return;
        const scrollPos = document.getElementById('contentZone').scrollTop;
        fs.collection('users_data').doc(currentUser.uid).set(userDb).then(() => { document.getElementById('contentZone').scrollTop = scrollPos; });
    }

    function updateSharedCatalogue(itemName, shopName, price) {
        if (!itemName) return;
        const normalized = itemName.trim();
        const docId = normalized.toLowerCase().replace(/[^a-z0-9]/g, "_");
        fs.collection('global_catalogue').doc(docId).get().then(doc => {
            let pricesObj = {};
            if (doc.exists) pricesObj = doc.data().prices || {};
            if (shopName) pricesObj[shopName] = parseFloat(price) || 0;
            fs.collection('global_catalogue').doc(docId).set({ name: normalized, prices: pricesObj }, { merge: true });
        });
    }

    function upBudget(v) { userDb.budget = parseFloat(v) || 0; cloudSave(); }

    // --- PROMOTIONS PAR PÉRIODE (catalogue) ---
    // Format stocké dans chaque produit du catalogue : promos: { "Magasin": [ { price, from, to }, ... ] }
    function todayStr() {
        const d = new Date();
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }
    function fmtDate(s) { return s ? s.split('-').reverse().join('/') : ''; }
    function esc(t) { return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }
    function encShop(s) { return encodeURIComponent(s).replace(/'/g, '%27'); }

    function promoStatus(p) {
        const t = todayStr();
        if (t < p.from) return 'future';
        if (t > p.to) return 'past';
        return 'active';
    }
    // Promo en cours (la moins chère) pour un produit du catalogue dans un magasin, sinon null
    function getActivePromo(item, shop) {
        const list = (item && item.promos && item.promos[shop]) || [];
        const actives = list.filter(p => promoStatus(p) === 'active' && p.price > 0);
        if (!actives.length) return null;
        return actives.reduce((m, p) => p.price < m.price ? p : m);
    }

    function addPromoToCat(docId) {
        const item = sharedCatalogue.find(c => c.id === docId);
        if (!item) return;
        const shop = document.getElementById('promoShop-' + docId).value;
        const price = parseFloat(document.getElementById('promoPrice-' + docId).value);
        const from = document.getElementById('promoFrom-' + docId).value;
        const to = document.getElementById('promoTo-' + docId).value;
        if (!shop) return alert("Choisissez un magasin pour la promo.");
        if (!(price > 0)) return alert("Indiquez le prix promo.");
        if (!from || !to) return alert("Indiquez la date de début et la date de fin.");
        if (to < from) return alert("La date de fin doit être après la date de début.");
        const promos = JSON.parse(JSON.stringify(item.promos || {}));
        if (!promos[shop]) promos[shop] = [];
        promos[shop].push({ price: price, from: from, to: to });
        fs.collection('global_catalogue').doc(docId).update({ promos: promos });
    }

    function delPromoFromCat(docId, encodedShop, idx) {
        const item = sharedCatalogue.find(c => c.id === docId);
        if (!item || !item.promos) return;
        const shop = decodeURIComponent(encodedShop);
        if (!confirm("Supprimer cette promotion ?")) return;
        const promos = JSON.parse(JSON.stringify(item.promos));
        if (!promos[shop]) return;
        promos[shop].splice(idx, 1);
        if (promos[shop].length === 0) delete promos[shop];
        fs.collection('global_catalogue').doc(docId).update({ promos: promos });
    }

    let openPromoId = null; // produit dont le panneau promos est ouvert
    function togglePromoPanel(docId) {
        openPromoId = (openPromoId === docId) ? null : docId;
        renderCatList();
    }
    
    function addShop() { 
        const n = document.getElementById('inShop').value.trim(); 
        if(n) { 
            if (!userDb.shops.find(s => s.name.toLowerCase() === n.toLowerCase())) userDb.shops.push({ id: Date.now(), name: n, items: [] }); 
            const docId = n.toLowerCase().replace(/[^a-z0-9]/g, "_");
            fs.collection('global_shops').doc(docId).set({ name: n }, { merge: true });
            document.getElementById('inShop').value = ""; cloudSave(); 
        } 
    }
    
    function addItem(forcedName = null) {
        const n = forcedName || document.getElementById('inItem').value.trim();
        const sId = document.getElementById('selShop').value;
        if(!n || !sId) { if(forcedName) alert("Choisissez un magasin avant !"); return; }
        
        const shop = userDb.shops.find(s => s.id == sId);
        const catItem = sharedCatalogue.find(c => c.name.toLowerCase() === n.toLowerCase());
        
        let targetPrice = 0, targetPromo = 0;
        if (catItem && catItem.prices && catItem.prices[shop.name]) targetPrice = catItem.prices[shop.name];
        const activePromo = catItem ? getActivePromo(catItem, shop.name) : null;
        if (activePromo) targetPromo = activePromo.price;

        shop.items.push({ id: Date.now(), name: n, qty: 1, price: targetPrice, promo: targetPromo, checked: false });
        if(!catItem) updateSharedCatalogue(n, shop.name, 0);
        
        document.getElementById('inItem').value = ""; document.getElementById('suggestBox').style.display = 'none';
        cloudSave();
    }

    function doSuggest(v) {
        const box = document.getElementById('suggestBox');
        if(v.length < 1) { box.style.display = 'none'; return; }
        const hits = sharedCatalogue.filter(c => c.name.toLowerCase().includes(v.toLowerCase()));
        if(!hits.length) { box.style.display = 'none'; return; }
        
        const currentShopId = document.getElementById('selShop').value;
        const currentShop = userDb.shops.find(s => s.id == currentShopId);
        
        box.innerHTML = hits.map(h => {
            const sp = currentShop ? getActivePromo(h, currentShop.name) : null;
            const shopPrice = sp ? sp.price : ((currentShop && h.prices && h.prices[currentShop.name]) ? h.prices[currentShop.name] : 0);
            return `<div class="s-item" onclick="addItem('${h.name.replace(/'/g, "\\'")}')"><span>${h.name}</span><b${sp ? ' style="color:var(--promo-color)"' : ''}>${shopPrice > 0 ? shopPrice.toFixed(2)+'€' + (sp ? ' 🏷️' : '') : '-- €'}</b></div>`;
        }).join('');
        box.style.display = 'block';
    }

    function edit(sId, iId, task, val) {
        const s = userDb.shops.find(x => x.id == sId);
        const it = s.items.find(x => x.id == iId);
        if(task === 'qty') it.qty = Math.max(0, parseFloat((it.qty + val).toFixed(2)));
        if(task === 'qty_m') it.qty = Math.max(0, parseFloat(val) || 0);
        if(task === 'check') it.checked = !it.checked;
        if(task === 'name') { const newN = prompt("Nom de l'article :", it.name); if(newN && newN.trim()) it.name = newN.trim(); }
        if(task === 'price') { it.price = parseFloat(val) || 0; updateSharedCatalogue(it.name, s.name, it.price); }
        if(task === 'promo') it.promo = parseFloat(val) || 0;
        if(task === 'del') s.items = s.items.filter(x => x.id != iId);
        cloudSave();
    }

    // --- MODALE CATALOGUE ET COMPARATEUR ---
    function toggleCat(show) {
        const m = document.getElementById('modalCat');
        if(show) {
            // Remplir la liste des magasins pour l'ajout direct
            const shopSelect = document.getElementById('catNewShop');
            shopSelect.innerHTML = '<option value="">Magasin...</option>' + sharedShops.map(s => `<option value="${s}">${s}</option>`).join('');
            
            document.getElementById('catSearch').value = ""; // Reset recherche
            renderCatList();
            m.style.display = 'flex';
        } else {
            openPromoId = null;
            m.style.display = 'none';
        }
    }

    function addDirectToCat() {
        const n = document.getElementById('catNewName').value.trim();
        const s = document.getElementById('catNewShop').value;
        const p = parseFloat(document.getElementById('catNewPrice').value) || 0;
        
        if(!n) return alert("Le nom du produit est requis.");
        updateSharedCatalogue(n, s, p);
        
        document.getElementById('catNewName').value = ""; 
        document.getElementById('catNewPrice').value = "";
    }

    function renderCatList() {
        const b = document.getElementById('catBody');
        const searchInput = document.getElementById('catSearch').value.toLowerCase();
        
        b.innerHTML = "";
        
        let filteredList = sharedCatalogue;
        if(searchInput) {
            filteredList = sharedCatalogue.filter(c => c.name.toLowerCase().includes(searchInput));
        }

        if (filteredList.length === 0) {
            b.innerHTML = "<div style='text-align:center; padding:20px; color:#999;'>Aucun article trouvé.</div>";
            return;
        }

        filteredList.sort((a,b) => a.name.localeCompare(b.name)).forEach((c) => {
            const pricesObj = c.prices || {};
            const promosObj = c.promos || {};
            const shops = Array.from(new Set(Object.keys(pricesObj).concat(Object.keys(promosObj))));

            // Prix effectif par magasin : promo en cours si elle existe, sinon prix normal
            const eff = {};
            shops.forEach(shop => {
                const ap = getActivePromo(c, shop);
                eff[shop] = ap ? ap.price : (pricesObj[shop] || 0);
            });

            // Calcul du prix le moins cher (> 0), promos comprises
            let minPrice = Infinity;
            shops.forEach(shop => {
                if(eff[shop] > 0 && eff[shop] < minPrice) minPrice = eff[shop];
            });

            // Création de la liste des prix avec surbrillance
            let pricesHtml = shops.map(shop => {
                const ap = getActivePromo(c, shop);
                const p = eff[shop];
                if(!(p > 0)) return '';
                const isMin = (p === minPrice);
                const style = isMin ? 'color:var(--primary); font-weight:bold;' : 'color:#555;';
                const badge = isMin ? ' <span style="background:var(--primary); color:white; padding:2px 5px; border-radius:4px; font-size:0.6rem; margin-left:5px;">Moins cher</span>' : '';
                if (ap) {
                    const normal = pricesObj[shop] > 0 ? ` <s style="color:#999; font-weight:normal;">${pricesObj[shop].toFixed(2)}€</s>` : '';
                    return `<li style="margin-bottom:3px; ${style}">${esc(shop)} : <span style="color:var(--promo-color);">${p.toFixed(2)}€</span>${normal} <span style="background:var(--promo-color); color:white; padding:2px 5px; border-radius:4px; font-size:0.6rem;">🏷️ Promo jusqu'au ${fmtDate(ap.to)}</span>${badge}</li>`;
                }
                return `<li style="margin-bottom:3px; ${style}">${esc(shop)} : ${p.toFixed(2)}€${badge}</li>`;
            }).join('');

            // Panneau de gestion des promotions (ouvert à la demande)
            let promoPanel = '';
            if (openPromoId === c.id) {
                const rows = [];
                Object.keys(promosObj).forEach(shop => {
                    (promosObj[shop] || []).forEach((p, i) => rows.push({ shop: shop, idx: i, p: p }));
                });
                rows.sort((a, b) => a.p.from.localeCompare(b.p.from));
                const statusLabel = { active: ['En cours', 'var(--primary)'], future: ['À venir', 'var(--blue)'], past: ['Terminée', '#999'] };
                const rowsHtml = rows.map(r => {
                    const st = statusLabel[promoStatus(r.p)];
                    return `<div style="display:flex; justify-content:space-between; align-items:center; gap:6px; padding:4px 0; border-bottom:1px dashed #ddd; font-size:0.78rem;">
                        <span>${esc(r.shop)} : <b>${r.p.price.toFixed(2)}€</b> · du ${fmtDate(r.p.from)} au ${fmtDate(r.p.to)} <span style="color:${st[1]}; font-weight:bold;">(${st[0]})</span></span>
                        <button onclick="delPromoFromCat('${c.id}', '${encShop(r.shop)}', ${r.idx})" style="border:none; background:none; color:var(--danger); cursor:pointer;">✕</button>
                    </div>`;
                }).join('');
                const shopOptions = '<option value="">Magasin...</option>' + sharedShops.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
                promoPanel = `<div style="margin-top:8px; padding:8px; background:#f6f0fa; border:1px solid var(--promo-color); border-radius:6px;">
                    <div style="font-size:0.75rem; font-weight:bold; color:var(--promo-color); margin-bottom:5px;">🏷️ Promotions de ce produit</div>
                    ${rowsHtml || '<div style="font-size:0.75rem; color:#999; padding:4px 0;">Aucune promotion enregistrée.</div>'}
                    <div style="display:flex; gap:5px; flex-wrap:wrap; margin-top:8px;">
                        <select id="promoShop-${c.id}" style="flex:2; min-width:110px; padding:6px; border:1px solid #ccc; border-radius:4px;">${shopOptions}</select>
                        <input type="number" id="promoPrice-${c.id}" placeholder="Prix promo" step="0.01" style="flex:1; min-width:80px; max-width:90px; padding:6px; border:1px solid #ccc; border-radius:4px;">
                    </div>
                    <div style="display:flex; gap:5px; flex-wrap:wrap; align-items:center; margin-top:5px; font-size:0.72rem;">
                        <label>Du</label><input type="date" id="promoFrom-${c.id}" style="padding:5px; border:1px solid #ccc; border-radius:4px;">
                        <label>au</label><input type="date" id="promoTo-${c.id}" style="padding:5px; border:1px solid #ccc; border-radius:4px;">
                        <button class="btn btn-ok" onclick="addPromoToCat('${c.id}')" style="height:32px; padding:4px 12px;">Ajouter</button>
                    </div>
                </div>`;
            }

            b.innerHTML += `<div style="padding:12px 10px; border-bottom:1px solid #eee;">
                <div style="font-weight:bold; color:var(--dark); display:flex; justify-content:space-between; align-items:center;">
                    <span style="font-size:1.05rem;">${c.name}</span>
                    <span style="display:flex; gap:2px;">
                        <button onclick="togglePromoPanel('${c.id}')" style="color:var(--promo-color); border:none; background:none; cursor:pointer; font-size:0.8rem; padding:5px;">🏷️ Promos</button>
                        <button onclick="delCatItem('${c.id}')" style="color:var(--danger); border:none; background:none; cursor:pointer; font-size:0.8rem; padding:5px;">🗑️ Supprimer</button>
                    </span>
                </div>
                <ul style="margin:8px 0 0 15px; padding:0; font-size:0.85rem; list-style-type:square;">
                    ${pricesHtml || '<li style="color:#999;">Aucun prix enregistré</li>'}
                </ul>
                ${promoPanel}
            </div>`;
        });
    }

    function delCatItem(docId) {
        if(confirm("Attention : Supprimer définitivement cet article du catalogue pour tout le monde ?")) {
            fs.collection('global_catalogue').doc(docId).delete();
        }
    }

    // --- RENDU PRINCIPAL ---
    function clearShop(sId) { if(confirm("Vider ce magasin ?")) { userDb.shops.find(x => x.id == sId).items = []; cloudSave(); } }
    function delShop(id) { if(confirm("Supprimer ce magasin ?")) { userDb.shops = userDb.shops.filter(s => s.id != id); cloudSave(); } }
    function clearAll() { if(confirm("Vider toutes les listes ?")) { userDb.shops.forEach(s => s.items = []); cloudSave(); } }

    function render() {
    const zone = document.getElementById('contentZone');
    const sel = document.getElementById('selShop');
    const curS = sel.value;
    zone.innerHTML = "";
    sel.innerHTML = userDb.shops.length ? "" : '<option value="">Magasin...</option>';
    document.getElementById('inBudget').value = userDb.budget || 0;

    let tG = 0, cG = 0;
    userDb.shops.forEach(s => {
        const opt = document.createElement('option'); opt.value = s.id; opt.textContent = s.name; if(s.id == curS) opt.selected = true; sel.appendChild(opt);
        let sSum = 0, sCheck = 0;
        let itemsHtml = s.items.map(it => {
            const activePrice = (it.promo > 0) ? it.promo : it.price;
            const sub = it.qty * activePrice;
            tG += sub; if(it.checked) cG += sub; sSum += sub; if(it.checked) sCheck += sub;
            const isMobile = window.innerWidth < 750;

            const tools = `
                <div class="qty-ctrl"><button class="btn-q" onclick="edit(${s.id}, ${it.id}, 'qty', -1)">-</button><input type="number" step="any" class="in-q" value="${it.qty}" onchange="edit(${s.id}, ${it.id}, 'qty_m', this.value)"><button class="btn-q" onclick="edit(${s.id}, ${it.id}, 'qty', 1)">+</button></div>
                <div style="display:flex; flex-direction:column;"><label style="font-size:0.45rem; color:#999">Enseigne (${s.name})</label><input type="number" class="in-p" value="${it.price||''}" onblur="edit(${s.id}, ${it.id}, 'price', this.value)"></div>
                <div style="display:flex; flex-direction:column;"><label style="font-size:0.45rem; color:var(--promo-color)">Promo</label><input type="number" class="in-p in-promo" value="${it.promo||''}" onblur="edit(${s.id}, ${it.id}, 'promo', this.value)"></div>
                <div class="row-total">${sub.toFixed(2)}€</div>`;

            if(!isMobile) {
                return `<div class="item-row ${it.checked ? 'is-checked' : ''}">
                    <input type="checkbox" ${it.checked ? 'checked' : ''} onchange="edit(${s.id}, ${it.id}, 'check')">
                    <div class="name" onclick="edit(${s.id}, ${it.id}, 'name')">${it.name}</div>
                    ${tools}
                    <button class="btn-del" onclick="edit(${s.id}, ${it.id}, 'del')">✕</button>
                </div>`;
            } else {
                return `<div class="item-row ${it.checked ? 'is-checked' : ''}">
                    <div class="mobile-top-line">
                        <input type="checkbox" ${it.checked ? 'checked' : ''} onchange="edit(${s.id}, ${it.id}, 'check')">
                        <div class="name" onclick="edit(${s.id}, ${it.id}, 'name')">${it.name}</div>
                        <button class="btn-del" onclick="edit(${s.id}, ${it.id}, 'del')">✕</button>
                    </div>
                    <div class="mobile-bottom-line">${tools}</div>
                </div>`;
            }
        }).join('');
        zone.innerHTML += `<div class="shop-area" id="shopArea-${s.id}">
                                <div class="shop-title-bar">
                                    <strong>${s.name}</strong>
                                    <div style="display:flex; gap:5px; align-items:center;">
                                        <div class="badge bg-gray">${sSum.toFixed(2)}€</div>
                                        <div class="badge bg-green">🛒 ${sCheck.toFixed(2)}€</div>
                                        <button onclick="clearShop(${s.id})" style="background:none; border:none; color:var(--orange); cursor:pointer; font-size:1.1rem">🗑️</button>
                                        <button class="btn-del" style="font-size:1rem" onclick="delShop(${s.id})">✕</button>
                                        <div class="accordion">
                                            <button class="accordion-button" onclick="toggleShopView(${s.id})">☰</button>
                                        </div>
                                    </div>
                                </div>
                                <div class="shop-items" id="shopItems-${s.id}">
                                    <div>${itemsHtml || '<div style="padding:15px; text-align:center; color:#999; font-size:0.8rem;">Vide</div>'}</div>
                                </div>
                            </div>`;
    });
    const rem = userDb.budget - cG; document.getElementById('outTotal').innerText = tG.toFixed(2) + " €"; document.getElementById('outChecked').innerText = cG.toFixed(2) + " €";
    const oR = document.getElementById('outRest'); oR.innerText = rem.toFixed(2) + " €"; oR.style.color = rem < 0 ? "red" : "#2ecc71";
}


// Fonction pour ouvrir ou fermer la vue d'un magasin
function toggleShopView(shopId) {
    const shopArea = document.getElementById(`shopItems-${shopId}`);
    shopArea.classList.toggle('hidden');
}

// Fonction pour gérer l'affichage des magasins
function toggleShops() {
    const shopAreas = document.querySelectorAll('.shop-area');
    shopAreas.forEach(area => area.style.display = area.style.display === 'none' ? 'block' : 'none');
}

// Fonction pour gérer l'affichage de l'accordéon d'un magasin
function toggleAccordion(button) {
    const shopId = button.closest('.shop-area').id.replace('shopArea-', '');
    toggleShopView(shopId);
}
