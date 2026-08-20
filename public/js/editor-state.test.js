const {
  DEFAULT_IMAGE_ADJUSTMENTS,
  createPublication,
  resetImageAdjustments,
  setBrand,
  setContentField,
  setFamily,
  setFormatTheme,
  setFormatVariant,
  setImageAdjustment
} = require('./editor-state');

describe('editor-state', () => {
  test('cria uma publication com o modelo editorial inicial', () => {
    expect(createPublication()).toEqual({
      brand: null,
      family: null,
      content: { url: '', title: '', subtitle: '', tag: '', image: '' },
      formats: {
        feed: {
          variant: null,
          theme: null,
          imageAdjustments: { zoom: 1, x: 50, y: 50 }
        },
        story: {
          variant: null,
          theme: null,
          imageAdjustments: { zoom: 1, x: 50, y: 50 }
        }
      }
    });
    expect(DEFAULT_IMAGE_ADJUSTMENTS).toEqual({ zoom: 1, x: 50, y: 50 });
  });

  test('cria publications sem compartilhar objetos internos', () => {
    const first = createPublication();
    const second = createPublication();

    expect(first).not.toBe(second);
    expect(first.content).not.toBe(second.content);
    expect(first.formats).not.toBe(second.formats);
    expect(first.formats.feed).not.toBe(second.formats.feed);
    expect(first.formats.story.imageAdjustments).not.toBe(second.formats.story.imageAdjustments);
  });

  test('altera title somente no conteudo compartilhado e sem mutar o estado anterior', () => {
    const publication = createPublication();
    const next = setContentField(publication, 'title', 'Novo titulo');

    expect(next).not.toBe(publication);
    expect(next.content).not.toBe(publication.content);
    expect(next.formats).toBe(publication.formats);
    expect(next.content.title).toBe('Novo titulo');
    expect(next.formats.feed).not.toHaveProperty('title');
    expect(next.formats.story).not.toHaveProperty('title');
    expect(publication.content.title).toBe('');
  });

  test.each([
    ['subtitle', 'Subtitulo'],
    ['tag', 'Politica'],
    ['url', 'https://example.com/noticia']
  ])('altera o campo compartilhado %s', (field, value) => {
    const next = setContentField(createPublication(), field, value);
    expect(next.content[field]).toBe(value);
  });

  test('troca a imagem compartilhada preservando os ajustes dos formatos', () => {
    const adjusted = setImageAdjustment(createPublication(), 'feed', 'zoom', 1.3);
    const next = setContentField(adjusted, 'image', 'https://example.com/image.jpg');

    expect(next.content.image).toBe('https://example.com/image.jpg');
    expect(next.formats).toBe(adjusted.formats);
    expect(next.formats.feed.imageAdjustments.zoom).toBe(1.3);
  });

  test('altera zoom do Feed sem alterar Story', () => {
    const publication = createPublication();
    const next = setImageAdjustment(publication, 'feed', 'zoom', 1.05);

    expect(next.formats.feed.imageAdjustments.zoom).toBe(1.05);
    expect(next.formats.story).toBe(publication.formats.story);
    expect(publication.formats.feed.imageAdjustments.zoom).toBe(1);
  });

  test('altera x e y do Story sem alterar Feed', () => {
    const publication = createPublication();
    const withX = setImageAdjustment(publication, 'story', 'x', 70);
    const next = setImageAdjustment(withX, 'story', 'y', 40);

    expect(next.formats.story.imageAdjustments).toEqual({ zoom: 1, x: 70, y: 40 });
    expect(next.formats.feed).toBe(publication.formats.feed);
  });

  test('altera variant do Feed sem alterar Story', () => {
    const publication = setFormatVariant(createPublication(), 'story', 'foto-acima');
    const next = setFormatVariant(publication, 'feed', 'foto-lateral');

    expect(next.formats.feed.variant).toBe('foto-lateral');
    expect(next.formats.story.variant).toBe('foto-acima');
  });

  test('altera theme do Story sem alterar Feed', () => {
    const publication = setFormatTheme(createPublication(), 'feed', 'branco');
    const next = setFormatTheme(publication, 'story', 'preto');

    expect(next.formats.story.theme).toBe('preto');
    expect(next.formats.feed.theme).toBe('branco');
  });

  test('reseta somente os ajustes do Feed', () => {
    let publication = createPublication();
    publication = setImageAdjustment(publication, 'feed', 'zoom', 1.3);
    publication = setImageAdjustment(publication, 'feed', 'x', 25);
    publication = setImageAdjustment(publication, 'story', 'zoom', 1.2);
    const next = resetImageAdjustments(publication, 'feed');

    expect(next.formats.feed.imageAdjustments).toEqual(DEFAULT_IMAGE_ADJUSTMENTS);
    expect(next.formats.story).toBe(publication.formats.story);
    expect(publication.formats.feed.imageAdjustments).toEqual({ zoom: 1.3, x: 25, y: 50 });
  });

  test('reseta somente os ajustes do Story e aceita defaults futuros', () => {
    let publication = setImageAdjustment(createPublication(), 'feed', 'y', 60);
    publication = setImageAdjustment(publication, 'story', 'zoom', 1.2);
    const next = resetImageAdjustments(publication, 'story', { zoom: 1.1, y: 45 });

    expect(next.formats.story.imageAdjustments).toEqual({ zoom: 1.1, x: 50, y: 45 });
    expect(next.formats.feed).toBe(publication.formats.feed);
  });

  test('atualiza brand e family sem inferir compatibilidade', () => {
    const publication = setFormatTheme(createPublication(), 'feed', 'editorial');
    const branded = setBrand(publication, 'marca-futura');
    const next = setFamily(branded, 'familia-futura');

    expect(next.brand).toBe('marca-futura');
    expect(next.family).toBe('familia-futura');
    expect(next.formats).toBe(publication.formats);
    expect(publication.brand).toBeNull();
  });

  test.each([
    () => setFormatVariant(createPublication(), 'square', 'destaque'),
    () => setFormatTheme(createPublication(), 'square', 'claro'),
    () => setImageAdjustment(createPublication(), 'square', 'zoom', 1.2),
    () => resetImageAdjustments(createPublication(), 'square')
  ])('gera erro explicito para formato invalido', operation => {
    expect(operation).toThrow('Unknown publication format: square');
  });

  test('gera erro explicito para content field invalido', () => {
    expect(() => setContentField(createPublication(), 'author', 'Nome'))
      .toThrow('Unknown content field: author');
  });

  test('gera erro explicito para image adjustment invalido', () => {
    expect(() => setImageAdjustment(createPublication(), 'feed', 'rotation', 90))
      .toThrow('Unknown image adjustment: rotation');
  });

  test('opera sobre um formato adicional sem regras especificas de Feed ou Story', () => {
    const publication = createPublication();
    const extended = {
      ...publication,
      formats: {
        ...publication.formats,
        square: {
          variant: null,
          theme: null,
          imageAdjustments: { ...DEFAULT_IMAGE_ADJUSTMENTS }
        }
      }
    };
    const withVariant = setFormatVariant(extended, 'square', 'destaque');
    const next = setImageAdjustment(withVariant, 'square', 'zoom', 1.25);

    expect(next.formats.square).toEqual({
      variant: 'destaque',
      theme: null,
      imageAdjustments: { zoom: 1.25, x: 50, y: 50 }
    });
    expect(next.formats.feed).toBe(extended.formats.feed);
    expect(next.formats.story).toBe(extended.formats.story);
  });
});
