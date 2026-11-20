import { useState, useEffect, isValidElement } from 'react'
import type { ReactNode } from 'react'
import { Check, Clipboard } from 'lucide-react'
import { Highlight } from 'prism-react-renderer'
import type { PrismTheme } from 'prism-react-renderer'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

const prismTheme: PrismTheme = {
  plain: { color: 'var(--text)', backgroundColor: 'transparent' },
  styles: [
    { types: ['comment', 'prolog', 'punctuation'], style: { color: 'var(--muted)' } },
    { types: ['string', 'attr-value', 'inserted'], style: { color: 'var(--add-text)' } },
    { types: ['keyword', 'tag', 'number', 'boolean'], style: { color: '#c6a18d' } },
    { types: ['function', 'class-name', 'property'], style: { color: '#c5b58d' } },
    { types: ['deleted'], style: { color: 'var(--delete-text)' } },
  ],
}

const languageNames: Record<string, string> = {
  javascript: 'JavaScript', typescript: 'TypeScript', jsx: 'JSX', tsx: 'TSX',
  python: 'Python', bash: 'Shell', yaml: 'YAML', html: 'HTML', css: 'CSS',
  json: 'JSON', markdown: 'Markdown', rust: 'Rust', go: 'Go', sql: 'SQL',
}

function CodeBlock({ children }: { children?: ReactNode }) {
  const [copy, setCopy] = useState('Copy')
  useEffect(() => {
    if (copy === 'Copy') return
    const timer = window.setTimeout(() => setCopy('Copy'), 2000)
    return () => window.clearTimeout(timer)
  }, [copy])
  const code = isValidElement<{ className?: string; children?: ReactNode }>(children) ? children.props : null
  const value = typeof code?.children === 'string' ? code.children.replace(/\n$/, '') : ''
  const label = code?.className?.match(/language-([^\s]+)/)?.[1]
  const aliases: Record<string, string> = { js: 'javascript', ts: 'typescript', sh: 'bash', shell: 'bash', py: 'python', yml: 'yaml', html: 'markup' }
  const language = aliases[label ?? ''] ?? label ?? 'plain'
  return (
    <div className="code-block">
      <div className="code-bar">
        <span>{languageNames[label ?? ''] ?? languageNames[language] ?? label ?? 'Code'}</span>
        <button type="button" onClick={async () => {
          try {
            await navigator.clipboard.writeText(value)
            setCopy('Copied')
          } catch {
            setCopy('Copy failed')
          }
        }} aria-live="polite">
          {copy === 'Copied' ? <Check size={13} /> : <Clipboard size={13} />}{copy}
        </button>
      </div>
      <Highlight theme={prismTheme} code={value} language={language}>
        {({ style, tokens, getLineProps, getTokenProps }) => (
          <pre style={style}>
            {tokens.map((line, index) => (
              <div key={index} {...getLineProps({ line })}>
                {line.map((token, i) => <span key={i} {...getTokenProps({ token })} />)}
              </div>
            ))}
          </pre>
        )}
      </Highlight>
    </div>
  )
}

export default function AssistantMarkdown({ text }: { text: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          pre: CodeBlock,
          a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer">{children}</a>,
          img: ({ alt }) => <span>[{alt || 'Image'}]</span>,
        }}
      >{text}</ReactMarkdown>
    </div>
  )
}
