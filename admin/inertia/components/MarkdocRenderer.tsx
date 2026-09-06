import React, { useState } from 'react'
import Markdoc from '@markdoc/markdoc'
import { IconCopy, IconCheck } from '@tabler/icons-react'
import { Heading } from './markdoc/Heading'
import { List } from './markdoc/List'
import { ListItem } from './markdoc/ListItem'
import { Image } from './markdoc/Image'
import { Table, TableHead, TableBody, TableRow, TableHeader, TableCell } from './markdoc/Table'

const DEBUG = true

function DebugLabel({ name, props }: { name: string; props: Record<string, unknown> }) {
  const propSummary = Object.entries(props)
    .filter(([k]) => k !== 'children')
    .map(([k, v]) => {
      const val =
        typeof v === 'string' ? `"${v.slice(0, 30)}${v.length > 30 ? '…' : ''}"` : String(v)
      return `${k}=${val}`
    })
    .join(' ')
  const childSummary = props.children
    ? `children=${Array.isArray(props.children) ? `array[${(props.children as unknown[]).length}]` : typeof props.children}`
    : ''
  return (
    <div className="bg-desert-red/80 px-2 py-0.5 text-[10px] font-mono text-white break-all">
      [DEBUG {name}] {propSummary || 'no-props'} {childSummary}
    </div>
  )
}

function withDebug<P extends Record<string, unknown>>(
  name: string,
  Component: React.ComponentType<P>
): React.ComponentType<P> {
  if (!DEBUG) return Component
  const Wrapped = (props: P) => {
    console.log(`[${name}] props:`, props)
    return (
      <div className="outline-1 outline-dashed outline-desert-red/60 -outline-offset-1">
        <DebugLabel name={name} props={props as Record<string, unknown>} />
        <Component {...props} />
      </div>
    )
  }
  Wrapped.displayName = `withDebug(${name})`
  return Wrapped
}

// Paragraph component
const Paragraph = ({ children }: { children: React.ReactNode }) => {
  return <p className="mb-4 leading-relaxed text-desert-green-darker/85">{children}</p>
}

// Link component
const Link = ({
  href,
  title,
  children,
}: {
  href: string
  title?: string
  children: React.ReactNode
}) => {
  const isExternal = href?.startsWith('http')
  return (
    <a
      href={href}
      title={title}
      className="text-desert-orange font-medium hover:text-desert-orange-dark underline decoration-desert-orange-lighter/50 underline-offset-2 hover:decoration-desert-orange transition-colors"
      {...(isExternal ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
    >
      {children}
    </a>
  )
}

// Inline code component
const InlineCode = ({ content, children }: { content?: string; children?: React.ReactNode }) => {
  return (
    <code className="bg-desert-green-lighter/30 text-desert-green-darker border border-desert-green-lighter/50 px-1.5 py-0.5 rounded text-[0.875em] font-mono">
      {content || children}
    </code>
  )
}

// Code block component
const CodeBlock = ({
  content,
  language,
  children,
}: {
  content?: string
  language?: string
  children?: React.ReactNode
}) => {
  const [copied, setCopied] = useState(false)
  const code = content || (typeof children === 'string' ? children : '')

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code)
    } catch {
      const textarea = document.createElement('textarea')
      textarea.value = code
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="my-6 overflow-hidden rounded-lg border border-desert-green-dark/20 relative group">
      {language && (
        <div className="bg-desert-green-dark px-4 py-1.5 text-xs font-mono text-desert-green-lighter uppercase tracking-wider">
          {language}
        </div>
      )}
      <button
        onClick={handleCopy}
        className="absolute top-2 right-2 p-1.5 rounded-md bg-desert-green-dark/60 hover:bg-desert-green-dark text-desert-green-lighter transition-colors"
        title="Copy to clipboard"
      >
        {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
      </button>
      <pre className="bg-desert-green-darker overflow-x-auto p-4">
        <code className="text-sm font-mono text-desert-green-lighter leading-relaxed whitespace-pre">
          {code}
        </code>
      </pre>
    </div>
  )
}

// Horizontal rule component
const HorizontalRule = () => {
  return (
    <hr className="my-10 border-0 h-px bg-linear-to-r from-transparent via-desert-tan-lighter to-transparent" />
  )
}

// Callout component
const Callout = ({
  type = 'info',
  title,
  children,
}: {
  type?: string
  title?: string
  children: React.ReactNode
}) => {
  const styles: Record<string, string> = {
    info: 'bg-desert-sand/60 border-desert-olive text-desert-green-darker',
    warning: 'bg-desert-orange-lighter/15 border-desert-orange text-desert-green-darker',
    error: 'bg-desert-red-lighter/15 border-desert-red text-desert-green-darker',
    success: 'bg-desert-olive-lighter/15 border-desert-olive text-desert-green-darker',
  }

  return (
    <div className={`border-l-4 rounded-r-lg p-5 mb-6 ${styles[type] || styles.info}`}>
      {title && <h4 className="font-semibold mb-2">{title}</h4>}
      <div className="[&>p:last-child]:mb-0">{children}</div>
    </div>
  )
}

// Component mapping for Markdoc
const components = {
  Paragraph: withDebug('Paragraph', Paragraph),
  Image: withDebug('Image', Image),
  Link: withDebug('Link', Link),
  InlineCode: withDebug('InlineCode', InlineCode),
  CodeBlock: withDebug('CodeBlock', CodeBlock),
  HorizontalRule: withDebug('HorizontalRule', HorizontalRule),
  Callout: withDebug('Callout', Callout),
  Heading: withDebug('Heading', Heading),
  List: withDebug('List', List),
  ListItem: withDebug('ListItem', ListItem),
  Table: withDebug('Table', Table),
  TableHead: withDebug('TableHead', TableHead),
  TableBody: withDebug('TableBody', TableBody),
  TableRow: withDebug('TableRow', TableRow),
  TableHeader: withDebug('TableHeader', TableHeader),
  TableCell: withDebug('TableCell', TableCell),
}

interface MarkdocRendererProps {
  content: any // Markdoc transformed content
}

const MarkdocRenderer: React.FC<MarkdocRendererProps> = ({ content }) => {
  return (
    <div className="text-base tracking-wide">
      {Markdoc.renderers.react(content, React, { components })}
    </div>
  )
}

export default MarkdocRenderer
