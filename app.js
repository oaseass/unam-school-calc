(function () {
  "use strict";
  var S = window.SCHOOLS;
  var $ = function (id) { return document.getElementById(id); };
  var state = { sex: "여", origin: null, calc: null, tok: 0 };
  var NOM = "https://nominatim.openstreetmap.org/search";
  var VAL = "https://valhalla1.openstreetmap.de/sources_to_targets";
  var RULE = { "여": { total: 14, pick: 9 }, "남": { total: 17, pick: 10 } };

  function msg(t) { var m = $("msg"); m.hidden = !t; m.textContent = t || ""; }
  function pool() { return S.filter(function (s) { return s.type === "공학" || s.type === (state.sex === "여" ? "여자" : "남자"); }); }
  function pillOf(s) { return s.type === "여자" ? ["g", "여자"] : s.type === "남자" ? ["b", "남자"] : ["c", "남녀공학"]; }
  function wc(m) { return m <= 20 ? "w1" : m <= 45 ? "w2" : "w3"; }
  function enc(s) { return encodeURIComponent(s); }

  function hav(a, b) {
    var R = 6371000, r = Math.PI / 180;
    var dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
    var x = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.sqrt(x));
  }

  /* ---------- 주소 검색 ---------- */
  function variants(q) {
    var s = q.replace(/광주광역시|전남광주통합특별시|광주시/g, "광주").replace(/\s+/g, " ").trim();
    s = s.replace(/(로|길|대로)\s*(\d+(-\d+)?)\s*(번지|번)?$/, "$1 $2");
    var noNum = s.replace(/\s+\d+(-\d+)?\s*(번지)?$/, "");
    var noDong = s.split(" ").filter(function (t) { return !/^[가-힣0-9]+(동|읍|면)$/.test(t); }).join(" ");
    var noDongNoNum = noDong.replace(/\s+\d+(-\d+)?\s*(번지)?$/, "");
    function gj(x) { return /광주/.test(x) ? x : "광주 " + x; }
    var v = [s, gj(s), noNum, gj(noNum), noDong, gj(noDong), gj(noDongNoNum)];
    return v.filter(function (x, i) { return x && v.indexOf(x) === i; });
  }
  function geocode(q) {
    var vs = variants(q), i = 0;
    function next() {
      if (i >= vs.length) return Promise.resolve([]);
      var url = NOM + "?format=jsonv2&countrycodes=kr&accept-language=ko&limit=5&q=" + enc(vs[i++]);
      return fetch(url).then(function (r) { return r.json(); }).then(function (a) {
        return a.length ? a : new Promise(function (res) { setTimeout(res, 1100); }).then(next);
      });
    }
    return next();
  }
  function onSearch(e) {
    e.preventDefault();
    var q = $("q").value.trim();
    if (q.length < 3) { msg("주소를 조금 더 자세히 입력해 주세요."); return; }
    msg(""); $("cands").innerHTML = ""; $("chosen").hidden = true;
    $("go").disabled = true; $("go").textContent = "찾는 중";
    geocode(q).then(function (a) {
      if (!a.length) { msg("주소를 찾지 못했습니다. 도로명 주소(예: 광주 북구 운암로 100)로 다시 검색해 보세요. 아파트 단지 이름만 넣어도 찾을 수 있습니다. 집에 계시면 '현재 위치로 계산'을 눌러 보세요."); return; }
      if (a.length === 1) { pick({ lat: +a[0].lat, lon: +a[0].lon, label: a[0].display_name }); return; }
      var box = $("cands");
      a.forEach(function (x) {
        var b = document.createElement("button");
        b.type = "button"; b.className = "cand"; b.textContent = x.display_name.replace(/, 대한민국$/, "");
        b.onclick = function () { pick({ lat: +x.lat, lon: +x.lon, label: x.display_name }); };
        box.appendChild(b);
      });
      msg("가장 비슷한 곳을 골라 주세요.");
    }).catch(function () {
      msg("주소 검색 서비스에 연결하지 못했습니다. 잠시 뒤에 다시 해 보세요.");
    }).then(function () { $("go").disabled = false; $("go").textContent = "검색"; });
  }
  function onGps() {
    if (!navigator.geolocation) { msg("이 기기에서는 현재 위치를 쓸 수 없습니다."); return; }
    msg(""); $("gps").disabled = true;
    navigator.geolocation.getCurrentPosition(function (p) {
      $("gps").disabled = false;
      pick({ lat: p.coords.latitude, lon: p.coords.longitude, label: "현재 위치" });
    }, function () {
      $("gps").disabled = false; msg("현재 위치를 가져오지 못했습니다. 위치 권한을 허용하거나 주소를 입력해 주세요.");
    }, { enableHighAccuracy: true, timeout: 12000 });
  }
  function pick(o) {
    state.origin = o; $("cands").innerHTML = ""; msg("");
    var c = $("chosen"); c.hidden = false; c.textContent = "";
    c.appendChild(document.createTextNode("선택한 위치: " + o.label.replace(/, 대한민국$/, "") + "  "));
    var a = document.createElement("a");
    a.href = "https://map.kakao.com/link/map/" + enc("우리집") + "," + o.lat + "," + o.lon;
    a.target = "_blank"; a.rel = "noopener"; a.textContent = "지도에서 확인";
    c.appendChild(a);
    calc();
  }

  /* ---------- 거리 계산 ---------- */
  function matrix(costing, list) {
    var o = state.origin;
    var body = { sources: [{ lon: o.lon, lat: o.lat }], targets: list.map(function (s) { return { lon: s.lon, lat: s.lat }; }), costing: costing };
    var ctl = new AbortController();
    var timer = setTimeout(function () { ctl.abort(); }, 9000);
    return fetch(VAL + "?json=" + enc(JSON.stringify(body)), { signal: ctl.signal })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        clearTimeout(timer);
        var a = j.sources_to_targets[0];
        return { d: a.map(function (v) { return v.distance == null ? null : v.distance * 1000; }), t: a.map(function (v) { return v.time == null ? null : v.time; }) };
      }, function (e) { clearTimeout(timer); throw e; });
  }
  function calc() {
    var list = pool(), o = state.origin;
    if (!o) return;
    var out = $("out"); out.hidden = false;
    var tok = ++state.tok;
    var af = { d: [], t: [] }, ac = { d: [], t: [] };
    list.forEach(function (s) { var m = hav(o, s) * 1.3; af.d.push(m); af.t.push(m / 1.3); ac.d.push(m); ac.t.push(m / 7); });
    finish(list, af, ac, "loading");
    $("out").scrollIntoView({ behavior: "smooth", block: "start" });
    var carP = retry(function () { return matrix("auto", list); }, 1).catch(function () { return null; });
    var footP = retry(function () { return matrix("pedestrian", list); }, 1).catch(function () { return null; });
    Promise.all([carP, footP]).then(function (r) {
      if (tok !== state.tok) return;
      var car = r[0], foot = r[1], miss = 0;
      var f = { d: [], t: [] }, c = { d: [], t: [] };
      list.forEach(function (s, i) {
        if (foot && foot.t[i] != null) { f.d.push(foot.d[i]); f.t.push(foot.t[i]); } else { miss++; f.d.push(af.d[i]); f.t.push(af.t[i]); }
        if (car && car.t[i] != null) { c.d.push(car.d[i]); c.t.push(car.t[i]); } else { miss++; c.d.push(ac.d[i]); c.t.push(ac.t[i]); }
      });
      finish(list, f, c, miss === list.length * 2 ? true : miss > 0 ? "part" : false);
    });
  }
  function retry(fn, n) {
    return fn().catch(function (e) {
      if (n <= 0) throw e;
      return new Promise(function (res) { setTimeout(res, 600); }).then(function () { return retry(fn, n - 1); });
    });
  }
  function finish(list, f, c, approx) {
    var o = state.origin;
    var rows = list.map(function (s, i) {
      var km = (f.d[i] || c.d[i] || 0) / 1000;
      return { s: s, km: km, walk: Math.round((f.t[i] || 0) / 60), car: Math.max(2, Math.round((c.t[i] || 0) / 60)), far: hav(o, s) > 40000 };
    }).sort(function (a, b) { return a.km - b.km; });
    state.calc = rows;
    render(rows, approx);
  }

  /* ---------- 화면 ---------- */
  function short(n) { return n.replace("광주", "").replace("전남대학교사범대학부설고등학교", "전남대 사대부고"); }
  function render(rows, approx) {
    var o = state.origin, r = RULE[state.sex];
    var best = rows[0], fast = rows.slice().sort(function (a, b) { return b.s.j.y4 - a.s.j.y4; })[0];
    var sum = $("sum"); sum.innerHTML = "";
    [["가장 가까운 곳", short(best.s.name) + " <em>" + best.km.toFixed(1) + "km</em>"],
     ["도보 최단", "<em>" + Math.min.apply(null, rows.map(function (x) { return x.walk; })) + "분</em>"],
     ["진학률 최고", short(fast.s.name) + " <em>" + fast.s.j.y4 + "%</em>"]].forEach(function (x) {
      var d = document.createElement("div"); d.innerHTML = "<small>" + x[0] + "</small><b>" + x[1] + "</b>"; sum.appendChild(d);
    });
    $("rule").innerHTML = "<b>" + (state.sex === "여" ? "여학생" : "남학생") + "은 " + r.total + "곳 중 " + r.pick + "곳 이상</b>을 적어내면 컴퓨터 추첨으로 배정됩니다. 가까운 학교가 꼭 배정되는 것은 아닙니다."
      + (approx === "loading" ? "<br><span style='color:var(--brand)'>지금은 어림값입니다. 실제 길로 정확하게 계산하는 중이라 몇 초 뒤에 숫자가 바뀝니다.</span>" : approx === "part" ? "<br><span style='color:var(--warn)'>일부 학교는 길찾기 서비스에 연결하지 못해 직선거리로 어림한 값입니다.</span>" : approx ? "<br><span style='color:var(--warn)'>길찾기 서비스에 연결하지 못해 직선거리로 어림한 값입니다.</span>" : "")
      + (rows.some(function (x) { return x.far; }) ? "<br><span style='color:var(--warn)'>입력한 위치가 광주에서 멀리 떨어져 있습니다. 주소를 다시 확인해 주세요.</span>" : "");
    var list = $("list"); list.innerHTML = "";
    rows.forEach(function (x, i) {
      var s = x.s, p = pillOf(s), rv = s.rv;
      var card = document.createElement("article"); card.className = "card";
      var to = enc(s.name) + "," + s.lat + "," + s.lon;
      var from = enc("우리집") + "," + o.lat + "," + o.lon;
      var review = rv.p || rv.c ?
        '<details class="rv"><summary>후기 보기 <span class="fine">' + esc(rv.s) + "</span></summary>" +
        (rv.p ? '<span class="tag p">👍 ' + esc(rv.p) + "</span>" : "") + (rv.c ? '<span class="tag c">⚠ ' + esc(rv.c) + "</span>" : "") + "</details>"
        : '<div class="fine">후기: ' + esc(rv.s) + "</div>";
      card.innerHTML =
        '<div class="ch"><div class="rk">' + (i + 1) + '</div><div class="ct"><h3>' + esc(s.name) + '<span class="pill ' + p[0] + '">' + p[1] + "</span></h3><p>" + esc(s.addr + (s.note ? " · " + s.note : "")) + "</p></div></div>" +
        '<div class="mets"><div class="met"><small>거리</small><b>' + x.km.toFixed(1) + "<i>km</i></b></div>" +
        '<div class="met"><small>도보</small><b class="' + wc(x.walk) + '">' + x.walk + "<i>분</i></b></div>" +
        '<div class="met"><small>자가용</small><b>' + x.car + "<i>분</i></b></div></div>" +
        '<div class="body"><div class="jin"><div class="top"><span>4년제 진학률 (2025)</span><b>' + s.j.y4 + '%</b></div><div class="prog"><b style="width:' + s.j.y4 + '%"></b></div>' +
        '<div class="fine">졸업생 ' + s.j.g + "명 · 전체 진학 " + s.j.all + "% · " + s.j.gr + "등급 · 인서울은 공개 자료 없음</div></div>" +
        review +
        '<div class="lnk"><a class="main" href="https://map.kakao.com/link/by/traffic/' + from + "/" + to + '" target="_blank" rel="noopener">대중교통 길찾기</a>' +
        '<a href="https://map.kakao.com/link/map/' + to + '" target="_blank" rel="noopener">학교 위치</a></div></div>';
      list.appendChild(card);
    });
  }
  function esc(t) { return String(t).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  $("f").addEventListener("submit", onSearch);
  $("gps").addEventListener("click", onGps);
  $("sex").addEventListener("click", function (e) {
    var b = e.target.closest("button"); if (!b) return;
    state.sex = b.dataset.v;
    Array.prototype.forEach.call($("sex").children, function (x) { x.classList.toggle("on", x === b); });
    if (state.origin) calc();
  });
})();
