const fs = require('fs');
const path = require('path');
const vm = require('vm');

test('bootstrap inicia diretamente o controller editorial com a bridge técnica', () => {
  const initialize = jest.fn();
  const createEditorController = jest.fn().mockReturnValue({ initialize });
  const context = {
    document: {},
    Api: {},
    EditorState: {},
    EditorCatalog: {},
    FrontendUtils: {},
    LegacyEditorBridge: {},
    EditorUi: { createEditorController },
  };
  context.window = context;
  vm.createContext(context);

  vm.runInContext(
    fs.readFileSync(path.join(__dirname, 'editor-bootstrap.js'), 'utf8'),
    context,
    { filename: 'public/js/editor-bootstrap.js' }
  );

  expect(createEditorController).toHaveBeenCalledWith({
    document: context.document,
    api: context.Api,
    state: context.EditorState,
    catalogHelpers: context.EditorCatalog,
    frontendUtils: context.FrontendUtils,
    legacyBridge: context.LegacyEditorBridge,
  });
  expect(context.EditorController).toBe(createEditorController.mock.results[0].value);
  expect(initialize).toHaveBeenCalledTimes(1);
});
