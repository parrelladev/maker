(function (global) {
  function waitForImages(doc) {
    return Promise.all(Array.from(doc.images || []).map((image) => {
      if (image.complete) {
        if (image.naturalWidth <= 0) {
          return Promise.reject(new Error('Não foi possível carregar uma imagem do preview'));
        }
        return image.decode ? image.decode().catch(() => {}) : Promise.resolve();
      }
      return new Promise((resolve, reject) => {
        image.addEventListener('load', () => {
          if (image.naturalWidth > 0) {
            resolve();
          } else {
            reject(new Error('Não foi possível carregar uma imagem do preview'));
          }
        }, { once: true });
        image.addEventListener('error', () => {
          reject(new Error('Não foi possível carregar uma imagem do preview'));
        }, { once: true });
      });
    }));
  }

  async function verifyExportableImages(doc) {
    const remoteUrls = Array.from(doc.images || [])
      .map((image) => image.currentSrc || image.src)
      .filter((url) => /^https?:\/\//i.test(url));

    await Promise.all(Array.from(new Set(remoteUrls)).map(async (url) => {
      const response = await fetch(url, { mode: 'cors' });
      if (!response.ok) throw new Error(`Imagem externa indisponível (${response.status})`);
    }));
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function downloadPreview(frame, manifestData, filename = 'arte.png', { assertCurrent = null } = {}) {
    const frameDocument = frame && frame.contentDocument;
    const frameWindow = frame && frame.contentWindow;
    const node = frameDocument && frameDocument.documentElement;
    if (!node) throw new Error('O preview ainda não está pronto');
    if (!frameWindow?.htmlToImage) throw new Error('Biblioteca de exportação não carregada');

    const width = Number(manifestData?.manifest?.dimensions?.width) || 1080;
    const height = Number(manifestData?.manifest?.dimensions?.height) || 1920;

    if (frameDocument.fonts?.ready) await frameDocument.fonts.ready;
    await waitForImages(frameDocument);
    await verifyExportableImages(frameDocument);
    if (assertCurrent && !assertCurrent()) return false;

    let blob;
    try {
      blob = await frameWindow.htmlToImage.toBlob(node, {
        width,
        height,
        canvasWidth: width,
        canvasHeight: height,
        pixelRatio: 1,
        cacheBust: true,
        backgroundColor: '#000',
        skipAutoScale: true,
        style: {
          width: `${width}px`,
          height: `${height}px`,
          transform: 'none',
          transformOrigin: 'top left',
        },
      });
    } catch (error) {
      throw new Error(`Falha ao capturar o preview. Verifique o CORS da imagem: ${error.message}`);
    }

    if (!blob) throw new Error('Não foi possível converter o preview em PNG');
    if (assertCurrent && !assertCurrent()) return false;
    downloadBlob(blob, filename);
  }

  global.PreviewExport = { downloadPreview };
})(window);
