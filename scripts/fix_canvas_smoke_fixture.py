from pathlib import Path

path = Path('web/scripts/check-chat-agent-ui.mjs')
text = path.read_text(encoding='utf-8')
start = text.index("        body: 'event: delta", text.index("await page.route('**/api/chat'"))
end = text.index("\n      });", start)
replacement = "        body: ['event: delta', `data: ${JSON.stringify({ text: chatMessages.at(-1).content })}`, '', 'event: complete', `data: ${JSON.stringify({ assistant: chatMessages.at(-1).content })}`, '', ''].join('\\n')"
text = text[:start] + replacement + text[end:]
text = text.replace(
    "    await expect(page.getByRole('textbox', { name: 'Editable code canvas' })).toContainText('<h1 id=\"preview-title\">Hello</h1>');",
    "    await expect(page.getByRole('textbox', { name: 'Editable code canvas' })).toHaveValue(/preview-title.*Hello/);",
)
text = text.replace(
    "    await expect(page.getByRole('textbox', { name: 'Editable code canvas' })).toContainText('console.log(\"second block\")');",
    "    await expect(page.getByRole('textbox', { name: 'Editable code canvas' })).toHaveValue('console.log(\"second block\");');",
)
path.write_text(text, encoding='utf-8')
print('Fixed SSE smoke fixture and textarea assertions')
