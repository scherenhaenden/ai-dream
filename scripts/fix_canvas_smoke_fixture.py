from pathlib import Path

path = Path('web/scripts/check-chat-agent-ui.mjs')
text = path.read_text(encoding='utf-8')
start = text.index("        body: 'event: delta", text.index("await page.route('**/api/chat'"))
end = text.index("\n      });", start)
replacement = "        body: ['event: delta', `data: ${JSON.stringify({ text: chatMessages.at(-1).content })}`, '', 'event: complete', `data: ${JSON.stringify({ assistant: chatMessages.at(-1).content })}`, '', ''].join('\\n')"
path.write_text(text[:start] + replacement + text[end:], encoding='utf-8')
print('Fixed SSE smoke fixture JSON encoding')
