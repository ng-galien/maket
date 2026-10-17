import { useEffect, useState } from "react";

/** Narrow windows and primary-touch devices use the connected reading shell.
 * The touch condition also covers an unfolded phone or a landscape tablet. */
export function useMobileReader() {
	const query = "(max-width: 959px), (pointer: coarse)";
	const [mobile, setMobile] = useState(
		() => window.matchMedia?.(query).matches ?? false,
	);
	useEffect(() => {
		const media = window.matchMedia?.(query);
		if (!media) return;
		const update = () => setMobile(media.matches);
		media.addEventListener("change", update);
		update();
		return () => media.removeEventListener("change", update);
	}, []);
	return mobile;
}
