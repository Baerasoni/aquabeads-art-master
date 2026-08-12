// おまかせ調整カード。実行中は進捗バーとキャンセルを表示する。
// children（プリセットのチップ行など）はボタンの下に描画される

import type { ReactNode } from 'react'

export interface AutoAdjustRunState {
  done: number
  total: number
  best: number
}

interface Props {
  disabled: boolean
  running: AutoAdjustRunState | null
  /** 完了後の「スコア 62 → 78」表示。空なら説明文を出す */
  note: string
  onRun: () => void
  onCancel: () => void
  children?: ReactNode
}

export function AutoAdjustButton({ disabled, running, note, onRun, onCancel, children }: Props) {
  return (
    <section className="card reveal" aria-label="おまかせ調整">
      <div className="auto-adjust">
        <button
          type="button"
          className="btn btn-primary"
          disabled={disabled || running !== null}
          onClick={onRun}
        >
          おまかせ調整
        </button>
        {running ? (
          <div className="auto-adjust-progress">
            <progress value={Math.min(running.done, running.total)} max={running.total} />
            <button type="button" className="btn-link" onClick={onCancel}>
              キャンセル
            </button>
          </div>
        ) : (
          <p className="field-hint" style={{ margin: 0 }}>
            {note || '画像に合わせて色数・明るさ・輪郭などを自動で探索します'}
          </p>
        )}
      </div>
      {children}
    </section>
  )
}
