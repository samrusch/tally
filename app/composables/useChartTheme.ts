/** Reads the active daisyUI theme colors so chart text and grid lines match light and dark mode. */
export function useChartTheme() {
  const theme = reactive({ text: '#5a6660', grid: '#e3e7e0', surface: '#ffffff' })

  function read() {
    const styles = getComputedStyle(document.documentElement)
    const get = (name: string, fallback: string) => styles.getPropertyValue(name).trim() || fallback
    theme.text = get('--color-base-content', theme.text)
    theme.grid = get('--color-base-300', theme.grid)
    theme.surface = get('--color-base-100', theme.surface)
  }

  onMounted(() => {
    read()
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    media.addEventListener('change', read)
    onBeforeUnmount(() => media.removeEventListener('change', read))
  })

  return theme
}
