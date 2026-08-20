import { Head, usePage } from '@inertiajs/react'
import ChatComponent from '~/components/chat'

export default function Chat(props: { settings: { chatSuggestionsEnabled: boolean } }) {
  const { aiAssistantName } = usePage<{ aiAssistantName: string }>().props
  return (
    <div className="w-full h-full">
      <Head title={aiAssistantName}>
        <style>{'body { overflow: hidden !important; }'}</style>
      </Head>
      <ChatComponent enabled={true} suggestionsEnabled={props.settings.chatSuggestionsEnabled} />
    </div>
  )
}
