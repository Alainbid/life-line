/**
 * A widget that creates a link that hooks into the navigator
 */

lifeLine.makeDom.register("link", {
	make(opts) {
		return {
			tag: "a",
			attrs: {
				href: opts.href
			},
			on: {
				click: e => {
					// don't over ride ctrl or alt or shift clicks
					if(e.ctrlKey || e.altKey || e.shiftKey) return;

					// don't navigate the page
					e.preventDefault();

					lifeLine.nav.navigate(opts.href)
				}
			},
			text: opts.text
		};
	}
});
