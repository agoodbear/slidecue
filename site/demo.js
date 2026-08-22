/* 戴上 G2 看出去的模擬。
   兩件事：①場景隨轉頭移動 ②字始終停在視野同一個位置。
   後者正是 AR 眼鏡與「投影在牆上」的差別，也是這個模擬要傳達的重點。 */
(function () {
  const vp = document.querySelector('.viewport')
  if (!vp) return
  const scene = vp.querySelector('.scene')
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches

  // ── 觀眾席剪影：程式生成，比手寫幾十個 div 好維護 ──
  const rows = vp.querySelector('.rows')
  for (let r = 0; r < 3; r++) {
    const y = r * 13, scale = 1 + r * 0.35
    for (let i = 0; i < 9; i++) {
      const el = document.createElement('i')
      const w = 7 * scale
      el.style.left = (i * 11.5 + (r % 2 ? 4 : 0) - 4) + '%'
      el.style.bottom = y + '%'
      el.style.width = w + '%'
      el.style.height = (16 * scale) + '%'
      el.style.opacity = String(0.55 + r * 0.15)
      rows.appendChild(el)
    }
  }

  // ── 轉頭：場景移動，HUD 不動 ──
  let tx = 0, ty = 0
  function look(nx, ny) {          // nx, ny 皆為 -1..1
    tx = Math.max(-1, Math.min(1, nx))
    ty = Math.max(-1, Math.min(1, ny))
    scene.style.transform = `translate(${tx * -6}%, ${ty * -4}%) scale(1.06)`
  }

  vp.addEventListener('pointermove', e => {
    const r = vp.getBoundingClientRect()
    look((e.clientX - r.left) / r.width * 2 - 1, (e.clientY - r.top) / r.height * 2 - 1)
  })
  vp.addEventListener('pointerleave', () => look(0, 0))

  // 手機：用實際的傾斜，體感更接近真的戴著眼鏡轉頭
  if (window.DeviceOrientationEvent && !reduce) {
    addEventListener('deviceorientation', e => {
      if (e.gamma == null) return
      look(e.gamma / 35, ((e.beta ?? 45) - 45) / 35)
    }, { passive: true })
  }

  // 沒人互動時自己輕輕飄，暗示「這裡可以動」
  let idle = 0
  if (!reduce) {
    setInterval(() => {
      idle += 0.02
      if (Math.abs(tx) < 0.02 && Math.abs(ty) < 0.02) {
        scene.style.transform =
          `translate(${Math.sin(idle) * -1.6}%, ${Math.cos(idle * .7) * -1}%) scale(1.06)`
      }
    }, 60)
  }

  // ── 講稿：箭頭逐行往下，重現語音跟隨 ──
  const caret = vp.querySelectorAll('.caret span')
  const lines = vp.querySelectorAll('.lines p')
  let cur = 0
  function step() {
    caret.forEach((c, i) => c.classList.toggle('on', i === cur))
    lines.forEach((l, i) => l.classList.toggle('on', i === cur))
    cur = (cur + 1) % lines.length
  }
  step()
  if (!reduce) setInterval(step, 2600)

  // ── 時鐘：真的在走，讓畫面有生命 ──
  const clock = vp.querySelector('[data-clock]')
  const elapsed = vp.querySelector('[data-elapsed]')
  const t0 = Date.now()
  function tick() {
    const d = new Date()
    if (clock) clock.textContent =
      '現在 ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
    if (elapsed) {
      const m = Math.floor((Date.now() - t0) / 60000)
      elapsed.textContent = '授課 ' + m + ' 分'
    }
  }
  tick()
  setInterval(tick, 10000)
})()
