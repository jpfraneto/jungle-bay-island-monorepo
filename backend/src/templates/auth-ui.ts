import { COLORS } from './styles'

export function renderTopbarAuth(): string {
  return `<a href="/info" class="auth-btn" style="text-decoration:none">Info</a>`
}

export function renderMiniappSdk(): string {
  return `<script type="module">
  import { sdk } from 'https://esm.sh/@farcaster/miniapp-sdk'
  sdk.actions.ready()
  // Expose Farcaster embedded wallet provider globally for non-module scripts
  try {
    if (sdk.wallet && sdk.wallet.getEthereumProvider) {
      Promise.resolve(sdk.wallet.getEthereumProvider()).then(function(provider) {
        if (provider && typeof provider.request === 'function') {
          window.__FC_PROVIDER__ = provider
          if (window.__onFcProvider) window.__onFcProvider(provider)
        }
      }).catch(function(e) { console.warn('FC wallet provider error:', e) })
    }
  } catch(e) { console.warn('FC wallet provider not available:', e) }
</script>`
}

export function renderMiniappEmbed(opts?: {
  imageUrl?: string
  buttonTitle?: string
  launchUrl?: string
}): string {
  const image = opts?.imageUrl ?? 'https://memetics.lat/og-image.png'
  const title = opts?.buttonTitle ?? 'Explore Tokens'
  const url = opts?.launchUrl ?? 'https://memetics.lat'
  const meta = {
    version: '1',
    imageUrl: image,
    button: {
      title,
      action: {
        type: 'launch_miniapp',
        name: 'Memetics',
        url,
        splashImageUrl: 'https://memetics.lat/splash.png',
        splashBackgroundColor: '#0a0e14',
      },
    },
  }
  // Escape for HTML attribute
  const json = JSON.stringify(meta).replace(/&/g, '&amp;').replace(/'/g, '&#39;').replace(/</g, '&lt;')
  return `<meta name="fc:miniapp" content='${json}' />`
}
