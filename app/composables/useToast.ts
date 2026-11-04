interface Toast {
  id: number
  type: 'success' | 'error'
  text: string
}

export function useToast() {
  const toasts = useState<Toast[]>('toasts', () => [])

  function push(type: Toast['type'], text: string) {
    const id = Date.now() + Math.random()
    toasts.value = [...toasts.value, { id, type, text }]
    setTimeout(() => {
      toasts.value = toasts.value.filter((t) => t.id !== id)
    }, 4000)
  }

  return {
    toasts,
    success: (text: string) => push('success', text),
    error: (text: string) => push('error', text),
  }
}
