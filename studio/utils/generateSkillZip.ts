import JSZip from 'jszip'
import {assembleSkillMd, getRefFilePath, type SkillInvocation} from './assemble'

interface SkillForZip {
  skillName: string
  description: string
  content: string
  references?: Array<{filename: string; content: string} | null> | null
  invocation?: SkillInvocation
}

export async function generateSkillZip(skill: SkillForZip): Promise<Blob> {
  const zip = new JSZip()
  const folder = zip.folder(skill.skillName)!
  folder.file('SKILL.md', assembleSkillMd(skill))
  if (skill.references) {
    const refsFolder = folder.folder('references')!
    for (const ref of skill.references) {
      if (!ref) continue
      refsFolder.file(getRefFilePath(ref.filename), ref.content + '\n')
    }
  }
  return zip.generateAsync({type: 'blob'})
}

export function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
