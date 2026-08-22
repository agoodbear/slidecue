/**
 * 講稿繼承。
 *
 * 解決一個實務問題：講者常把「同一段話」拆成好幾張投影片來做視覺變化
 * （箭頭移位、框線放大），這時通常只有第一張寫了附註，後面幾張是空的。
 * 若照實顯示，眼鏡會在演講中途突然變空白——正是最不能出事的時候。
 *
 * 規則：附註空白時沿用前一張的稿，並回報「這是同一段的第幾張」，
 * 讓眼鏡端能顯示 `▸ 2/3` 這種延續指示，講者才知道稿沒丟、只是還在同一段。
 */

export interface SlideScript {
  /** 投影片編號，1-based */
  slide: number
  /** 實際要顯示的講稿 */
  notes: string
  /** 是否沿用自前一張 */
  inherited: boolean
  /** 在這條繼承鏈中的位置，1-based */
  inheritIndex: number
  /** 這條繼承鏈的總張數 */
  inheritTotal: number
}

/**
 * 把原始附註陣列展開成每張投影片的有效講稿。
 *
 * @param notes 由 allNotes() 取得的原始附註，索引 0 對應第 1 張
 */
export function buildDeck(notes: string[]): SlideScript[] {
  const out: SlideScript[] = notes.map((n, i) => ({
    slide: i + 1,
    notes: n.trim(),
    inherited: false,
    inheritIndex: 1,
    inheritTotal: 1,
  }))

  // 第一遍：把空白往前補，並記錄各自屬於哪一條鏈
  let chainStart = -1
  for (let i = 0; i < out.length; i++) {
    if (out[i].notes) {
      chainStart = i
      out[i].inherited = false
      out[i].inheritIndex = 1
    } else if (chainStart >= 0) {
      out[i].notes = out[chainStart].notes
      out[i].inherited = true
      out[i].inheritIndex = i - chainStart + 1
    } else {
      // 開頭就空白，前面沒有東西可繼承，維持空稿
      out[i].inherited = false
      out[i].inheritIndex = 1
    }
  }

  // 第二遍：回填每條鏈的總長
  let i = 0
  while (i < out.length) {
    if (!out[i].notes) {
      out[i].inheritTotal = 1
      i++
      continue
    }
    let j = i
    while (j + 1 < out.length && out[j + 1].inherited) j++
    const len = j - i + 1
    for (let k = i; k <= j; k++) out[k].inheritTotal = len
    i = j + 1
  }

  return out
}
