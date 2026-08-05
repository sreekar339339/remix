import type { Handle } from 'remix/ui'
import { Layout } from '../ui/layout.tsx'

export function Index(handle: Handle<{ url?: URL }>) {
  return () => (
    <Layout url={handle.props.url}>
      <p>Pick apps from above links</p>
    </Layout>
  )
}
