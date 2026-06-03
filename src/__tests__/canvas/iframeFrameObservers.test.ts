import { describe, expect, it } from 'bun:test'
import {
  getIframeObserverConstructors,
  getIframeObserverDocument,
  observeIframeMutations,
} from '@site/canvas/iframeFrameObservers'

describe('getIframeObserverConstructors', () => {
  it('uses observer constructors from the iframe document window', () => {
    const FrameResizeObserver = function ResizeObserver() {} as unknown as typeof ResizeObserver
    const FrameMutationObserver = function MutationObserver() {} as unknown as typeof MutationObserver
    const iframe = {
      contentWindow: {
        ResizeObserver: FrameResizeObserver,
        MutationObserver: FrameMutationObserver,
      },
    } as unknown as HTMLIFrameElement

    expect(getIframeObserverConstructors(iframe)).toEqual({
      ResizeObserver: FrameResizeObserver,
      MutationObserver: FrameMutationObserver,
    })
  })

  it('uses the iframe window document as the observer target document', () => {
    const frameDocument = {} as Document
    const fallbackDocument = {} as Document
    const iframe = {
      contentWindow: {
        document: frameDocument,
      },
    } as unknown as HTMLIFrameElement

    expect(getIframeObserverDocument(iframe, fallbackDocument)).toBe(frameDocument)
  })

  it('disconnects and returns null when the browser rejects iframe mutation targets', () => {
    let disconnected = false
    class ThrowingMutationObserver {
      observe(): void {
        throw new TypeError('not a node')
      }

      disconnect(): void {
        disconnected = true
      }

      takeRecords(): MutationRecord[] {
        return []
      }
    }
    const iframeDoc = {
      body: {},
      head: {},
    } as unknown as Document

    const observer = observeIframeMutations(
      ThrowingMutationObserver as unknown as typeof MutationObserver,
      iframeDoc,
      () => {},
    )

    expect(observer).toBeNull()
    expect(disconnected).toBe(true)
  })
})
