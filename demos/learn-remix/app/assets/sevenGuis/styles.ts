import { css } from 'remix/ui'

export const taskCss = css({
  border: '1px solid #d4d4d8',
  borderRadius: 8,
  padding: 16,
  display: 'grid',
  gap: 12,
  boxShadow: '0 1px 2px rgba(15, 23, 42, 0.06)',
})

export const rowCss = css({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flexWrap: 'wrap',
  '&[hidden]': {
    display: 'none',
  },
})

export const inputCss = css({
  border: '1px solid #a1a1aa',
  borderRadius: 4,
  padding: '6px 8px',
  font: 'inherit',
  "&[aria-invalid='true']": {
    borderColor: '#dc2626',
    // background: "#fef2f2",
  },
})

export const buttonCss = css({
  border: '1px solid #71717a',
  borderRadius: 4,
  padding: '6px 10px',
  font: 'inherit',
  cursor: 'pointer',
  '&:disabled': {
    cursor: 'not-allowed',
    opacity: 0.45,
  },
})
