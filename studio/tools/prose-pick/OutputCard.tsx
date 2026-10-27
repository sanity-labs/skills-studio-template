import {Card, Stack, Text} from '@sanity/ui'

interface Props {
  label: string
  text: string
  selected: boolean
  onSelect: () => void
  disabled?: boolean
}

export function OutputCard({label, text, selected, onSelect, disabled}: Props) {
  return (
    <Card
      padding={3}
      radius={2}
      shadow={selected ? 2 : 1}
      tone={selected ? 'primary' : 'default'}
      onClick={disabled ? undefined : onSelect}
      style={{cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.7 : 1, height: '100%'}}
    >
      <Stack space={2}>
        <Text size={0} weight="semibold" muted>
          {label}
        </Text>
        <div
          style={{
            whiteSpace: 'pre-wrap',
            fontFamily: 'var(--font-family-mono, monospace)',
            fontSize: 13,
            lineHeight: 1.55,
            maxHeight: 360,
            overflowY: 'auto',
            padding: '4px 0',
          }}
        >
          {text}
        </div>
      </Stack>
    </Card>
  )
}
