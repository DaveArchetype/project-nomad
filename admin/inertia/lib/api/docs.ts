import { AxiosInstance } from 'axios'
import { catchInternal } from '../util'

export function listDocs(client: AxiosInstance) {
  return catchInternal(async () => {
    const response = await client.get<Array<{ title: string; slug: string }>>('/docs/list')
    return response.data
  })()
}
