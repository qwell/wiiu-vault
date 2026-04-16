const text = 'Hello world.';
console.log(text);

if (import.meta.vitest) {
  const { it, expect } = import.meta.vitest;
  it('inline test', () => {
    expect(text).toBe('Hello world.');
  });
}
