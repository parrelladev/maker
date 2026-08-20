(function bootstrapEditor(global) {
  const controller = global.EditorUi.createEditorController({
    document: global.document,
    api: global.Api,
    state: global.EditorState,
    catalogHelpers: global.EditorCatalog,
    legacyBridge: global.LegacyEditorBridge,
  });
  global.EditorController = controller;
  controller.initialize();
})(window);
