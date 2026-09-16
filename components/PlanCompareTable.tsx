/** The two plans themselves, not this viewer's own allowance - see
 * app/account/licence/page.tsx and app/page.tsx, its two callers. No
 * prices; there is no price list. */
export type PlanCompare = {
  boards: string;
  slidesPerBoard: string;
  extraType: string;
};

/** Free vs Bespoke, shared by the homepage and /account/licence so the two
 * never drift apart - same intro line, same table. */
export function PlanCompareTable({ compare }: { compare: PlanCompare }) {
  return (
    <>
      <p className="ui-hint">
        There is no price list — a Bespoke plan is cut for whoever asks, from the Free plan's
        shape plus whatever they need. This is what changes between the two.
      </p>
      <table className="plan-compare">
        <thead>
          <tr>
            <th scope="col"></th>
            <th scope="col">Free</th>
            <th scope="col">Bespoke</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">Boards</th>
            <td>{compare.boards}</td>
            <td>More, or unlimited</td>
          </tr>
          <tr>
            <th scope="row">Slides per board</th>
            <td>{compare.slidesPerBoard}</td>
            <td>More</td>
          </tr>
          <tr>
            <th scope="row">Board types</th>
            <td>Live queue</td>
            <td>+ {compare.extraType}</td>
          </tr>
          <tr>
            <th scope="row">Private boards</th>
            <td>Not included</td>
            <td>Included</td>
          </tr>
          <tr>
            <th scope="row">Watermark</th>
            <td>On</td>
            <td>Off</td>
          </tr>
        </tbody>
      </table>
    </>
  );
}
