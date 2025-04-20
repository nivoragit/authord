import { InstanceProfile, TocElement} from "./types";
import {AbstractProduct} from "./authord";

export interface WritersideHelpTocElement extends TocElement {}

export interface WritersideHelpInstanceProfile extends InstanceProfile<WritersideHelpTocElement> {
  /** Path to the .tree file */
  treeFile: string;
}

export class WritersideHelpProduct
  extends AbstractProduct<WritersideHelpTocElement, WritersideHelpInstanceProfile>  {

}
