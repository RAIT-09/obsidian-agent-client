# Sending Images

Attach images to your messages to provide visual context to the AI agent.

## Agent Support

::: warning
Not all agents support image attachments. If your agent doesn't support images, you'll see a notification when attempting to attach one:

> [Agent Client] This agent does not support image attachments
:::

## Attaching Images

### Paste from Clipboard

1. Copy an image to your clipboard (screenshot, copied image, etc.)
2. Focus the input field
3. Paste with `Cmd/Ctrl + V`

### Drag and Drop

1. Drag image files from Finder/Explorer
2. Drop them onto the input area
3. The input area highlights when you drag over it

<p align="center">
  <img src="/images/sending-images.webp" alt="Sending Images" width="400" />
</p>

## Managing Attachments

Attached images appear as thumbnails below the text area.

- **Remove an image**: Hover over the thumbnail and click the **×** button
- **Images are sent with your message**: When you send, all attached images are included

<p align="center">
  <img src="/images/remove-image.webp" alt="Remove image button" width="400" />
</p>

## Supported Formats

| Format | MIME Type |
|--------|-----------|
| PNG | `image/png` |
| JPEG | `image/jpeg` |
| GIF | `image/gif` |
| WebP | `image/webp` |

## Limits

| Limit | Value |
|-------|-------|
| Maximum file size | 5 MB per image |
| Maximum images | 10 per message |

::: info
If you exceed these limits, a notification will inform you:
- `[Agent Client] Image too large (max 5MB)`
- `[Agent Client] Maximum 10 images allowed`
:::
