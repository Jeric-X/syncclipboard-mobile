import { addLibXposedCompileOnly, addLibXposedR8Rules } from '../../plugins/withModernXposedModule';

describe('modern Xposed module config plugin', () => {
  it('adds the API 102 compileOnly dependency exactly once', () => {
    const buildGradle = 'dependencies {\n}';
    const configured = addLibXposedCompileOnly(buildGradle);

    expect(configured).toContain('compileOnly "io.github.libxposed:api:102.0.0"');
    expect(addLibXposedCompileOnly(configured)).toBe(configured);
  });

  it('adds the official R8 entry-point rules exactly once', () => {
    const configured = addLibXposedR8Rules('# app rules\n');

    expect(configured).toContain('-adaptresourcefilecontents META-INF/xposed/java_init.list');
    expect(configured).toContain('extends io.github.libxposed.api.XposedModule');
    expect(addLibXposedR8Rules(configured)).toBe(configured);
  });
});
